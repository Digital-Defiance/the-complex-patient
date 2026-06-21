/**
 * Remote vault pull tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { wrapKey } from '@complex-patient/crypto-engine';
import { encrypt, decrypt } from '@complex-patient/crypto-engine';
import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultHttpClient } from '@complex-patient/sync-engine';
import { pullRemoteVaultPartitions } from './vault-pull';

const KEY = wrapKey(new Uint8Array(32).fill(7));

async function encryptBlob(records: unknown[] = []) {
  const payload = await encrypt(
    new TextEncoder().encode(JSON.stringify({ records })),
    KEY,
  );
  return {
    sync_version: 1,
    iv: payload.iv,
    auth_tag: payload.authTag,
    ciphertext: payload.ciphertext,
  };
}

describe('pullRemoteVaultPartitions', () => {
  it('writes remote blob when local partition is empty', async () => {
    const writePartition = vi.fn(async () => {});
    const vault = {
      readPartition: vi.fn(async () => null),
      writePartition,
    } as unknown as LocalVault;

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({
        status: 200,
        sync_version: 2,
        iv: 'iv',
        auth_tag: 'tag',
        ciphertext: 'cipher',
      })),
    };

    await pullRemoteVaultPartitions({ vault, http });

    expect(writePartition).toHaveBeenCalled();
    expect(writePartition.mock.calls[0]?.[0]).toBe('medications');
  });

  it('does not overwrite newer local blob', async () => {
    const writePartition = vi.fn(async () => {});
    const vault = {
      readPartition: vi.fn(async () => ({
        sync_version: 5,
        iv: 'local-iv',
        auth_tag: 'local-tag',
        ciphertext: 'local-cipher',
      })),
      writePartition,
    } as unknown as LocalVault;

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({
        status: 200,
        sync_version: 2,
        iv: 'remote-iv',
        auth_tag: 'remote-tag',
        ciphertext: 'remote-cipher',
      })),
    };

    await pullRemoteVaultPartitions({ vault, http });

    expect(writePartition).not.toHaveBeenCalled();
  });

  it('does not overwrite existing local blob when onlyIfLocalMissing is set', async () => {
    const writePartition = vi.fn(async () => {});
    const vault = {
      readPartition: vi.fn(async () => ({
        sync_version: 1,
        iv: 'local-iv',
        auth_tag: 'local-tag',
        ciphertext: 'local-cipher',
      })),
      writePartition,
    } as unknown as LocalVault;

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({
        status: 200,
        sync_version: 99,
        iv: 'remote-iv',
        auth_tag: 'remote-tag',
        ciphertext: 'remote-cipher',
      })),
    };

    await pullRemoteVaultPartitions({ vault, http, onlyIfLocalMissing: true });

    expect(writePartition).not.toHaveBeenCalled();
  });

  it('skips remote overwrite when blob fails decrypt verification', async () => {
    const localBlob = await encryptBlob([{ id: 'local', op_timestamp: 't' }]);
    const remoteBlob = await encryptBlob([{ id: 'remote', op_timestamp: 't' }]);
    const wrongKey = wrapKey(new Uint8Array(32).fill(9));

    const writePartition = vi.fn(async () => {});
    const vault = {
      readPartition: vi.fn(async () => localBlob),
      writePartition,
    } as unknown as LocalVault;

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({
        status: 200,
        ...remoteBlob,
        sync_version: remoteBlob.sync_version + 10,
      })),
    };

    await pullRemoteVaultPartitions({
      vault,
      http,
      verifyDecrypt: { kek: wrongKey, crypto: { decrypt } },
    });

    expect(writePartition).not.toHaveBeenCalled();
  });
});
