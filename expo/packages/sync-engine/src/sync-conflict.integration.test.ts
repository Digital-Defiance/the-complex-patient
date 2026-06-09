import { describe, it, expect, vi } from 'vitest';
import type { VaultType, VaultRecord, PartitionPayload } from '@complex-patient/domain';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
  type VaultBlob,
} from '@complex-patient/local-vault';
import { SyncWorker } from './sync-worker';
import { createConflictResolver, type ConflictFailureReason } from './conflict-resolver';
import type {
  VaultGetResponse,
  VaultPushPayload,
  VaultPushResponse,
  VaultHttpClient,
} from './sync-worker';

/**
 * Integration tests for the full HTTP 409 sync conflict cycle (task 8.8).
 *
 * Unlike the resolver unit tests, these wire the real collaborators together:
 * - the real {@link SyncWorker} (offline queue + push + 409 delegation),
 * - the real {@link createConflictResolver} injected as the worker's
 *   `resolveConflict` seam,
 * - a real {@link EncryptedLocalVault} over an in-memory storage backend, and
 * - the real Crypto_Engine (`encrypt`/`decrypt`) — no crypto mocks.
 *
 * Only the HTTP backend is faked, and it faithfully emulates the REST contract:
 * `postVault` enforces optimistic concurrency on `sync_version` (200 on match,
 * 409 on mismatch) and `getVault` returns the current stored blind envelope.
 *
 * Coverage:
 * - happy path: 409 → fetch → merge → re-push → 'conflict-resolved' + dequeue
 *   (Requirements 8.1, 8.5, 8.8)
 * - fetch failure/timeout aborts, local records retained unchanged (8.2)
 * - verification failure (tampered fetched blob) aborts, local unchanged (8.4)
 * - re-push 409 retry exhaustion after the additional retries (8.9)
 */

const VAULT: VaultType = 'medications';

/** A fixed, real 256-bit KEK shared by client and the seeded server blobs. */
const KEK: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(11));

const rec = (id: string, ts: string, extra: Record<string, unknown> = {}): VaultRecord =>
  ({ id, op_timestamp: ts, ...extra }) as VaultRecord;

/** Encrypt a record set into a stored VaultBlob using the real crypto-engine. */
async function makeBlob(records: VaultRecord[], syncVersion: number): Promise<VaultBlob> {
  const payload: PartitionPayload<VaultRecord> = { records };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const enc = await encrypt(plaintext, KEK);
  return {
    sync_version: syncVersion,
    iv: enc.iv,
    auth_tag: enc.authTag,
    ciphertext: enc.ciphertext,
  };
}

/** Decrypt a stored blob back into its records (real crypto round-trip). */
async function readRecords(blob: VaultBlob): Promise<VaultRecord[]> {
  const result = await decrypt(
    { iv: blob.iv, authTag: blob.auth_tag, ciphertext: blob.ciphertext },
    KEK,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('decrypt failed');
  }
  const parsed = JSON.parse(new TextDecoder().decode(result.plaintext)) as PartitionPayload<VaultRecord>;
  return parsed.records;
}

/**
 * A fake Sync_Backend honoring the `POST`/`GET /vault/{vault_type}` contract.
 *
 * It holds one stored blob per vault_type and enforces optimistic concurrency:
 * a push whose `sync_version` matches the stored version is accepted and the
 * version is incremented; a mismatch returns 409 with the current version. The
 * stored blob is a genuine encrypted envelope so the resolver decrypts it for
 * real on fetch.
 */
class FakeVaultServer implements VaultHttpClient {
  posts = 0;
  gets = 0;
  private stored: VaultBlob;

  constructor(
    initial: VaultBlob,
    private readonly opts: {
      /** When set, every push is rejected with 409 (perpetual concurrent writer). */
      alwaysConflict?: boolean;
      /** Override the GET behavior (e.g. throw, or return a tampered blob). */
      onGet?: (current: VaultBlob) => Promise<VaultGetResponse>;
    } = {},
  ) {
    this.stored = initial;
  }

  async getVault(_vaultType: VaultType): Promise<VaultGetResponse> {
    this.gets += 1;
    if (this.opts.onGet) {
      return this.opts.onGet(this.stored);
    }
    return {
      status: 200,
      sync_version: this.stored.sync_version,
      iv: this.stored.iv,
      auth_tag: this.stored.auth_tag,
      ciphertext: this.stored.ciphertext,
    };
  }

  async postVault(_vaultType: VaultType, payload: VaultPushPayload): Promise<VaultPushResponse> {
    this.posts += 1;
    if (this.opts.alwaysConflict || payload.sync_version !== this.stored.sync_version) {
      // A concurrent write already advanced the version: reject and (when
      // simulating a perpetual writer) advance again so the next fetch is fresh.
      if (this.opts.alwaysConflict) {
        this.stored = { ...this.stored, sync_version: this.stored.sync_version + 1 };
      }
      return { status: 409, sync_version: this.stored.sync_version };
    }
    const newVersion = this.stored.sync_version + 1;
    this.stored = {
      sync_version: newVersion,
      iv: payload.iv,
      auth_tag: payload.auth_tag,
      ciphertext: payload.ciphertext,
    };
    return { status: 200, sync_version: newVersion };
  }

  current(): VaultBlob {
    return this.stored;
  }
}

/** Wire a SyncWorker with the real conflict resolver over shared collaborators. */
function wire(opts: {
  http: FakeVaultServer;
  vault: LocalVault;
  onConflictError?: (v: VaultType, r: ConflictFailureReason) => void;
}): SyncWorker {
  const resolveConflict = createConflictResolver({
    http: opts.http,
    vault: opts.vault,
    crypto: { encrypt, decrypt },
    kek: KEK,
    onConflictError: opts.onConflictError,
  });
  return new SyncWorker({ http: opts.http, vault: opts.vault, resolveConflict });
}

describe('sync conflict cycle — full 409 → fetch → merge → re-push (Req 8.1, 8.5, 8.8)', () => {
  it('resolves the conflict, persists the merged union, and dequeues the partition', async () => {
    // Local has an unsynced edit at a stale version; the server moved ahead.
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z', { v: 'local' })], 1);
    const serverBlob = await makeBlob([rec('b', '2024-01-01T00:00:00Z', { v: 'remote' })], 2);

    const vault = await createLocalVault(new MemoryStorageBackend());
    await vault.writePartition(VAULT, localBlob);

    const server = new FakeVaultServer(serverBlob);
    const worker = wire({ http: server, vault });

    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);

    // The merged blob was accepted: server v2 (fetched) + 1 = v3.
    expect(outcome).toEqual({ status: 'conflict-resolved', newVersion: 3 });
    expect(worker.isQueued(VAULT)).toBe(false);
    expect(worker.isPending(VAULT)).toBe(false);

    // The worker pushed once (→409), then the resolver fetched once and re-pushed.
    expect(server.posts).toBe(2);
    expect(server.gets).toBe(1);

    // The merged partition is the chronological union of local + remote.
    const persisted = await vault.readPartition(VAULT);
    expect(persisted).not.toBeNull();
    expect(persisted!.sync_version).toBe(3);
    const merged = await readRecords(persisted!);
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);

    // The merged blob also became the new last-common-synced base.
    const base = await vault.readBase(VAULT);
    expect(base).not.toBeNull();
    const baseRecords = await readRecords(base!);
    expect(baseRecords.map((r) => r.id).sort()).toEqual(['a', 'b']);

    // The server now stores the merged union too (round-trips end to end).
    const serverRecords = await readRecords(server.current());
    expect(serverRecords.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});

describe('sync conflict cycle — fetch failure aborts (Req 8.2)', () => {
  it('retains the local records unchanged and surfaces FETCH_FAILED', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z', { v: 'local' })], 1);
    const serverBlob = await makeBlob([rec('b', '2024-01-01T00:00:00Z')], 2);

    const vault = await createLocalVault(new MemoryStorageBackend());
    await vault.writePartition(VAULT, localBlob);

    const server = new FakeVaultServer(serverBlob, {
      onGet: async () => {
        throw new Error('network down');
      },
    });
    const onConflictError = vi.fn<(v: VaultType, r: ConflictFailureReason) => void>();
    const worker = wire({ http: server, vault, onConflictError });

    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);

    expect(outcome).toEqual({ status: 'conflict-failed' });
    expect(onConflictError).toHaveBeenCalledWith(VAULT, 'FETCH_FAILED');
    // No re-push happened (only the worker's initial push).
    expect(server.posts).toBe(1);

    // The local partition is retained exactly as it was; no base was written.
    const persisted = await vault.readPartition(VAULT);
    expect(persisted).toEqual(localBlob);
    expect(await vault.readBase(VAULT)).toBeNull();
  });
});

describe('sync conflict cycle — verification failure aborts (Req 8.4)', () => {
  it('retains the local records unchanged when the fetched blob fails integrity verification', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z', { v: 'local' })], 1);
    const serverBlob = await makeBlob([rec('b', '2024-01-01T00:00:00Z')], 2);

    const vault = await createLocalVault(new MemoryStorageBackend());
    await vault.writePartition(VAULT, localBlob);

    // The server returns a blob whose ciphertext has been tampered with, so the
    // real Crypto_Engine auth-tag verification will fail on decrypt.
    const server = new FakeVaultServer(serverBlob, {
      onGet: async (current) => ({
        status: 200,
        sync_version: current.sync_version,
        iv: current.iv,
        auth_tag: current.auth_tag,
        ciphertext: Buffer.from('tampered-ciphertext-bytes').toString('base64'),
      }),
    });
    const onConflictError = vi.fn<(v: VaultType, r: ConflictFailureReason) => void>();
    const worker = wire({ http: server, vault, onConflictError });

    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);

    expect(outcome).toEqual({ status: 'conflict-failed' });
    expect(onConflictError).toHaveBeenCalledWith(VAULT, 'VERIFY_FAILED');
    // The fetch succeeded but the re-push never happened (only the initial push).
    expect(server.gets).toBe(1);
    expect(server.posts).toBe(1);

    // Local records retained unchanged; no merged base persisted.
    const persisted = await vault.readPartition(VAULT);
    expect(persisted).toEqual(localBlob);
    expect(await vault.readBase(VAULT)).toBeNull();
  });
});

describe('sync conflict cycle — re-push 409 retry exhaustion (Req 8.9)', () => {
  it('re-fetches/re-merges/re-pushes up to 3 additional times then aborts, retaining local records', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z', { v: 'local' })], 1);
    const serverBlob = await makeBlob([rec('b', '2024-01-01T00:00:00Z')], 2);

    const vault = await createLocalVault(new MemoryStorageBackend());
    await vault.writePartition(VAULT, localBlob);

    // A perpetual concurrent writer: every push is rejected with 409.
    const server = new FakeVaultServer(serverBlob, { alwaysConflict: true });
    const onConflictError = vi.fn<(v: VaultType, r: ConflictFailureReason) => void>();
    const worker = wire({ http: server, vault, onConflictError });

    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);

    expect(outcome).toEqual({ status: 'conflict-failed' });
    expect(onConflictError).toHaveBeenCalledWith(VAULT, 'RETRIES_EXHAUSTED');

    // The resolver performed 1 initial cycle + 3 additional retries = 4 fetch +
    // 4 re-push cycles; plus the worker's initial push that triggered the 409.
    expect(server.gets).toBe(4);
    expect(server.posts).toBe(1 + 4);

    // The partition is still queued (conflict unresolved) and never marked synced.
    expect(worker.isQueued(VAULT)).toBe(true);

    // Local records retained unchanged; no merged partition/base persisted.
    const persisted = await vault.readPartition(VAULT);
    expect(persisted).toEqual(localBlob);
    expect(await vault.readBase(VAULT)).toBeNull();
  });
});
