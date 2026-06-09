import { describe, it, expect, vi } from 'vitest';
import type { VaultType, VaultRecord, PartitionPayload } from '@complex-patient/domain';
import type { VaultBlob } from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import {
  createConflictResolver,
  type ConflictHttp,
  type ConflictVault,
  type ConflictFailureReason,
} from './conflict-resolver';
import type {
  Timer,
  TimerHandle,
  VaultGetResponse,
  VaultPushPayload,
  VaultPushResponse,
} from './sync-worker';

/**
 * Unit tests for the HTTP 409 conflict-resolution protocol (task 8.7).
 *
 * Coverage:
 * - successful 409 → fetch → decrypt/verify → three-way merge → re-encrypt →
 *   re-push (Requirements 8.1, 8.3, 8.5, 8.8)
 * - fetch failure / timeout aborts and retains local records unchanged (8.2)
 * - decrypt/verify failure aborts and retains local records unchanged (8.4)
 * - re-push 409 retry exhaustion (3 additional retries) (8.9)
 *
 * The Crypto_Engine is exercised for real (no mocks): a fixed 256-bit KEK is
 * used so encrypt/decrypt round-trips genuinely verify the auth tag.
 */

const VAULT: VaultType = 'medications';

/** A fixed, real 256-bit KEK wrapped for the crypto-engine free functions. */
const KEK: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(7));

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

/** Build a GET response from a stored blob. */
function getResponseFromBlob(blob: VaultBlob): VaultGetResponse {
  return {
    status: 200,
    sync_version: blob.sync_version,
    iv: blob.iv,
    auth_tag: blob.auth_tag,
    ciphertext: blob.ciphertext,
  };
}

/** A controllable in-memory ConflictVault that records writes. */
function stubVault(partition: VaultBlob | null, base: VaultBlob | null): ConflictVault & {
  writes: VaultBlob[];
  bases: VaultBlob[];
  partition: VaultBlob | null;
} {
  return {
    writes: [],
    bases: [],
    partition,
    async readPartition() {
      return this.partition;
    },
    async writePartition(_v, blob) {
      this.writes.push(blob);
      this.partition = blob;
    },
    async readBase() {
      return base;
    },
    async setBase(_v, blob) {
      this.bases.push(blob);
    },
  };
}

/** A real-ish synchronous timer that fires the timeout immediately when asked. */
function immediateTimer(): Timer & { fired: boolean } {
  return {
    fired: false,
    setTimeout(_handler: () => void, _ms: number): TimerHandle {
      // Never auto-fire; the racing promise resolves first in normal tests.
      return { id: 1 };
    },
    clearTimeout() {
      this.fired = true;
    },
  };
}

const rec = (id: string, ts: string, extra: Record<string, unknown> = {}): VaultRecord =>
  ({ id, op_timestamp: ts, ...extra }) as VaultRecord;

describe('createConflictResolver — successful 409 cycle (Req 8.1, 8.3, 8.5, 8.8)', () => {
  it('fetches, decrypts, merges, re-encrypts, and re-pushes the union', async () => {
    const local = [rec('a', '2024-01-02T00:00:00Z', { v: 'local' })];
    const remote = [rec('b', '2024-01-01T00:00:00Z', { v: 'remote' })];
    const base: VaultRecord[] = [];

    const localBlob = await makeBlob(local, 4);
    const baseBlob = await makeBlob(base, 3);
    const remoteBlob = await makeBlob(remote, 5);

    let pushedPayload: VaultPushPayload | null = null;
    let encryptCompletedBeforePush = false;
    const http: ConflictHttp = {
      async getVault() {
        return getResponseFromBlob(remoteBlob);
      },
      async postVault(_v, payload) {
        pushedPayload = payload;
        // Re-encryption must have completed: payload carries non-empty envelope.
        encryptCompletedBeforePush =
          typeof payload.iv === 'string' &&
          payload.ciphertext.length > 0 &&
          payload.auth_tag.length > 0;
        return { status: 200, sync_version: 6 };
      },
    };
    const vault = stubVault(localBlob, baseBlob);
    const resolve = createConflictResolver({ http, vault, crypto: { encrypt, decrypt }, kek: KEK });

    const outcome = await resolve(VAULT, 5);

    expect(outcome).toEqual({ status: 'conflict-resolved', newVersion: 6 });
    expect(encryptCompletedBeforePush).toBe(true);
    // The re-push uses the fetched stored version for optimistic concurrency.
    expect(pushedPayload!.sync_version).toBe(5);

    // The merged blob is decryptable and contains the union of local + remote.
    const dec = await decrypt(
      { iv: pushedPayload!.iv, authTag: pushedPayload!.auth_tag, ciphertext: pushedPayload!.ciphertext },
      KEK,
    );
    expect(dec.ok).toBe(true);
    if (dec.ok) {
      const merged = JSON.parse(new TextDecoder().decode(dec.plaintext)) as PartitionPayload<VaultRecord>;
      expect(merged.records.map((r) => r.id).sort()).toEqual(['a', 'b']);
    }

    // On success the merged blob is persisted as the new partition AND base.
    expect(vault.writes).toHaveLength(1);
    expect(vault.bases).toHaveLength(1);
    expect(vault.writes[0].sync_version).toBe(6);
    expect(vault.bases[0].sync_version).toBe(6);
  });
});

describe('createConflictResolver — fetch failure / timeout (Req 8.2)', () => {
  it('aborts and retains local records unchanged when the fetch rejects', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z')], 4);
    const http: ConflictHttp = {
      async getVault() {
        throw new Error('network down');
      },
      async postVault() {
        throw new Error('should not push');
      },
    };
    const vault = stubVault(localBlob, null);
    const onConflictError = vi.fn<(v: VaultType, r: ConflictFailureReason) => void>();
    const resolve = createConflictResolver({
      http,
      vault,
      crypto: { encrypt, decrypt },
      kek: KEK,
      onConflictError,
    });

    const outcome = await resolve(VAULT, 5);

    expect(outcome).toEqual({ status: 'conflict-failed' });
    expect(onConflictError).toHaveBeenCalledWith(VAULT, 'FETCH_FAILED');
    // Local records retained unchanged: no write-back happened.
    expect(vault.writes).toHaveLength(0);
    expect(vault.bases).toHaveLength(0);
  });

  it('aborts when the fetch does not complete within the timeout window', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z')], 4);
    // Timer that fires the timeout handler immediately, beating the never-
    // resolving fetch promise.
    let timeoutHandler: (() => void) | null = null;
    const timer: Timer = {
      setTimeout(handler) {
        timeoutHandler = handler;
        // Fire on next microtask so withTimeout has wired up.
        queueMicrotask(() => timeoutHandler?.());
        return { id: 1 };
      },
      clearTimeout() {},
    };
    const http: ConflictHttp = {
      getVault: () => new Promise<VaultGetResponse>(() => {}), // never resolves
      async postVault() {
        throw new Error('should not push');
      },
    };
    const vault = stubVault(localBlob, null);
    const resolve = createConflictResolver({
      http,
      vault,
      crypto: { encrypt, decrypt },
      kek: KEK,
      timer,
      fetchTimeoutMs: 10_000,
    });

    const outcome = await resolve(VAULT, 5);
    expect(outcome).toEqual({ status: 'conflict-failed' });
    expect(vault.writes).toHaveLength(0);
  });
});

describe('createConflictResolver — decrypt/verify failure (Req 8.4)', () => {
  it('aborts and retains local records when the fetched blob fails verification', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z')], 4);
    const remoteBlob = await makeBlob([rec('b', '2024-01-01T00:00:00Z')], 5);
    // Tamper with the fetched ciphertext so the auth tag verification fails.
    const tampered: VaultGetResponse = {
      ...getResponseFromBlob(remoteBlob),
      ciphertext: Buffer.from('totally-different-bytes').toString('base64'),
    };
    const http: ConflictHttp = {
      async getVault() {
        return tampered;
      },
      async postVault() {
        throw new Error('should not push');
      },
    };
    const vault = stubVault(localBlob, null);
    const onConflictError = vi.fn<(v: VaultType, r: ConflictFailureReason) => void>();
    const resolve = createConflictResolver({
      http,
      vault,
      crypto: { encrypt, decrypt },
      kek: KEK,
      onConflictError,
    });

    const outcome = await resolve(VAULT, 5);

    expect(outcome).toEqual({ status: 'conflict-failed' });
    expect(onConflictError).toHaveBeenCalledWith(VAULT, 'VERIFY_FAILED');
    expect(vault.writes).toHaveLength(0);
  });
});

describe('createConflictResolver — re-push 409 retry exhaustion (Req 8.9)', () => {
  it('re-fetches/re-merges/re-pushes up to 3 additional times then fails', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z')], 4);
    const remoteBlob = await makeBlob([rec('b', '2024-01-01T00:00:00Z')], 5);

    let gets = 0;
    let pushes = 0;
    const http: ConflictHttp = {
      async getVault() {
        gets += 1;
        return getResponseFromBlob(remoteBlob);
      },
      async postVault(): Promise<VaultPushResponse> {
        pushes += 1;
        return { status: 409, sync_version: 5 + pushes };
      },
    };
    const vault = stubVault(localBlob, null);
    const onConflictError = vi.fn<(v: VaultType, r: ConflictFailureReason) => void>();
    const resolve = createConflictResolver({
      http,
      vault,
      crypto: { encrypt, decrypt },
      kek: KEK,
      onConflictError,
    });

    const outcome = await resolve(VAULT, 5);

    expect(outcome).toEqual({ status: 'conflict-failed' });
    expect(onConflictError).toHaveBeenCalledWith(VAULT, 'RETRIES_EXHAUSTED');
    // 1 initial cycle + 3 additional retries = 4 total fetch/push cycles.
    expect(pushes).toBe(4);
    expect(gets).toBe(4);
    // Local records retained unchanged across the exhausted cycle.
    expect(vault.writes).toHaveLength(0);
    expect(vault.bases).toHaveLength(0);
  });

  it('recovers if a later cycle succeeds within the retry budget', async () => {
    const localBlob = await makeBlob([rec('a', '2024-01-02T00:00:00Z')], 4);
    const remoteBlob = await makeBlob([rec('b', '2024-01-01T00:00:00Z')], 5);

    let pushes = 0;
    const http: ConflictHttp = {
      async getVault() {
        return getResponseFromBlob(remoteBlob);
      },
      async postVault(): Promise<VaultPushResponse> {
        pushes += 1;
        if (pushes < 3) {
          return { status: 409, sync_version: 5 + pushes };
        }
        return { status: 200, sync_version: 99 };
      },
    };
    const vault = stubVault(localBlob, null);
    const resolve = createConflictResolver({ http, vault, crypto: { encrypt, decrypt }, kek: KEK });

    const outcome = await resolve(VAULT, 5);

    expect(outcome).toEqual({ status: 'conflict-resolved', newVersion: 99 });
    expect(pushes).toBe(3);
    expect(vault.writes).toHaveLength(1);
    expect(vault.bases).toHaveLength(1);
  });
});

describe('createConflictResolver — three-way merge precedence (Req 8.6, via 8.5)', () => {
  it('prefers the more recent op_timestamp on a genuine conflict', async () => {
    // Same id changed on both sides relative to base → conflict; local newer.
    const base = [rec('x', '2024-01-01T00:00:00Z', { v: 'base' })];
    const local = [rec('x', '2024-01-03T00:00:00Z', { v: 'local' })];
    const remote = [rec('x', '2024-01-02T00:00:00Z', { v: 'remote' })];

    const localBlob = await makeBlob(local, 4);
    const baseBlob = await makeBlob(base, 3);
    const remoteBlob = await makeBlob(remote, 5);

    let pushedPayload: VaultPushPayload | null = null;
    const http: ConflictHttp = {
      async getVault() {
        return getResponseFromBlob(remoteBlob);
      },
      async postVault(_v, payload) {
        pushedPayload = payload;
        return { status: 200, sync_version: 6 };
      },
    };
    const vault = stubVault(localBlob, baseBlob);
    const resolve = createConflictResolver({ http, vault, crypto: { encrypt, decrypt }, kek: KEK });

    await resolve(VAULT, 5);

    const dec = await decrypt(
      { iv: pushedPayload!.iv, authTag: pushedPayload!.auth_tag, ciphertext: pushedPayload!.ciphertext },
      KEK,
    );
    expect(dec.ok).toBe(true);
    if (dec.ok) {
      const merged = JSON.parse(new TextDecoder().decode(dec.plaintext)) as PartitionPayload<
        VaultRecord & { v: string }
      >;
      expect(merged.records).toHaveLength(1);
      expect(merged.records[0].v).toBe('local');
    }
  });
});
