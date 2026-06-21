import { describe, it, expect, vi } from 'vitest';
import type { VaultType, VaultRecord, PartitionPayload } from '@complex-patient/domain';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import {
  createLocalVault,
  MemoryStorageBackend,
  type VaultBlob,
} from '@complex-patient/local-vault';
import type {
  VaultGetResponse,
  VaultPushPayload,
  VaultPushResponse,
  VaultHttpClient,
} from '@complex-patient/sync-engine';
import { createSyncWorker } from './sync-worker';

const VAULT: VaultType = 'symptoms';
const KEK: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(3));

const rec = (id: string, ts: string): VaultRecord =>
  ({ id, op_timestamp: ts }) as VaultRecord;

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

class FakeVaultServer implements VaultHttpClient {
  posts = 0;
  gets = 0;
  private stored: VaultBlob;

  constructor(initial: VaultBlob) {
    this.stored = initial;
  }

  async getVault(_vaultType: VaultType): Promise<VaultGetResponse> {
    this.gets += 1;
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
    if (payload.sync_version !== this.stored.sync_version) {
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
}

describe('createSyncWorker', () => {
  it('resolves HTTP 409 via three-way merge instead of reporting conflict-failed', async () => {
    const localBlob = await makeBlob([rec('local', '2024-02-01T00:00:00Z')], 1);
    const serverBlob = await makeBlob([rec('remote', '2024-01-01T00:00:00Z')], 2);

    const vault = await createLocalVault(new MemoryStorageBackend());
    await vault.writePartition(VAULT, localBlob);

    const http = new FakeVaultServer(serverBlob);
    const keyStore = { getKek: vi.fn(() => KEK) };
    const worker = createSyncWorker({ http, vault, keyStore });

    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);

    expect(outcome).toEqual({ status: 'conflict-resolved', newVersion: 3 });
    expect(http.posts).toBe(2);
    expect(http.gets).toBe(1);
  });
});
