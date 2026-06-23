/**
 * Remote vault pull tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { wrapKey } from '@complex-patient/crypto-engine';
import { encrypt, decrypt } from '@complex-patient/crypto-engine';
import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultHttpClient } from '@complex-patient/sync-engine';
import { pullRemoteVaultPartitions, probeKekAgainstVaultData } from './vault-pull';

const KEY = wrapKey(new Uint8Array(32).fill(7));

async function encryptBlob(records: unknown[] = [], syncVersion = 1, key: typeof KEY = KEY) {
  const payload = await encrypt(
    new TextEncoder().encode(JSON.stringify({ records })),
    key,
  );
  return {
    sync_version: syncVersion,
    iv: payload.iv,
    auth_tag: payload.authTag,
    ciphertext: payload.ciphertext,
  };
}

function makeVault(partition: Awaited<ReturnType<typeof encryptBlob>> | null = null) {
  let stored = partition;
  let base: Awaited<ReturnType<typeof encryptBlob>> | null = null;
  return {
    readPartition: vi.fn(async () => stored),
    writePartition: vi.fn(async (_vt, blob) => {
      stored = blob;
    }),
    readBase: vi.fn(async () => base),
    setBase: vi.fn(async (_vt, blob) => {
      base = blob;
    }),
    getStored: () => stored,
  } as unknown as LocalVault & { getStored: () => typeof stored };
}

describe('pullRemoteVaultPartitions', () => {
  it('writes remote blob when local partition is empty', async () => {
    const remote = await encryptBlob();
    const vault = makeVault(null);

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({ status: 200, ...remote })),
    };

    await pullRemoteVaultPartitions({ vault, http });

    expect(vault.writePartition).toHaveBeenCalled();
    expect(vault.writePartition.mock.calls[0]?.[0]).toBe('medications');
  });

  it('does not overwrite newer local blob without verifyDecrypt', async () => {
    const local = await encryptBlob([], 5);
    const remote = await encryptBlob([], 2);
    const vault = makeVault(local);

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({ status: 200, ...remote })),
    };

    await pullRemoteVaultPartitions({ vault, http });

    expect(vault.writePartition).not.toHaveBeenCalled();
  });

  it('does not overwrite existing local blob when onlyIfLocalMissing is set', async () => {
    const local = await encryptBlob([], 1);
    const remote = await encryptBlob([], 99);
    const vault = makeVault(local);

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({ status: 200, ...remote })),
    };

    await pullRemoteVaultPartitions({
      vault,
      http,
      onlyIfLocalMissing: true,
      verifyDecrypt: { kek: KEY, crypto: { encrypt, decrypt } },
    });

    expect(vault.writePartition).not.toHaveBeenCalled();
  });

  it('pulls remote when local blob exists but does not decrypt with the current key', async () => {
    const staleKey = wrapKey(new Uint8Array(32).fill(9));
    const localBlob = await encryptBlob([{ id: 'local', op_timestamp: 't' }], 1, staleKey);
    const remoteBlob = await encryptBlob([{ id: 'remote', op_timestamp: 't' }], 11);

    const vault = makeVault(localBlob);

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({ status: 200, ...remoteBlob })),
    };

    await pullRemoteVaultPartitions({
      vault,
      http,
      onlyIfLocalMissing: true,
      verifyDecrypt: { kek: KEY, crypto: { encrypt, decrypt } },
    });

    expect(vault.writePartition).toHaveBeenCalledWith(
      'medications',
      expect.objectContaining({ sync_version: 11 }),
    );
  });

  it('merges unsynced local records when remote version is ahead', async () => {
    const localBlob = await encryptBlob(
      [{ id: 'local-only', op_timestamp: '2026-01-02T00:00:00Z' }],
      5,
    );
    const remoteBlob = await encryptBlob(
      [{ id: 'remote-only', op_timestamp: '2026-01-01T00:00:00Z' }],
      6,
    );
    const vault = makeVault(localBlob);

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async (vaultType) => {
        if (vaultType === 'symptoms') {
          return { status: 200, ...remoteBlob };
        }
        return { status: 404 };
      }),
    };

    const applied: string[] = [];
    await pullRemoteVaultPartitions({
      vault,
      http,
      verifyDecrypt: { kek: KEY, crypto: { encrypt, decrypt } },
      onPartitionApplied: async ({ vaultType, outcome }) => {
        applied.push(`${vaultType}:${outcome.needsPush}`);
      },
    });

    expect(applied).toContain('symptoms:true');
    const stored = vault.getStored();
    expect(stored?.sync_version).toBe(6);

    const decryptResult = await decrypt(
      { iv: stored!.iv, authTag: stored!.auth_tag, ciphertext: stored!.ciphertext },
      KEY,
    );
    expect(decryptResult.ok).toBe(true);
    if (decryptResult.ok) {
      const parsed = JSON.parse(new TextDecoder().decode(decryptResult.plaintext)) as {
        records: { id: string }[];
      };
      expect(parsed.records.map((r) => r.id).sort()).toEqual(['local-only', 'remote-only']);
    }
  });

  it('skips remote overwrite when blob fails decrypt verification', async () => {
    const localBlob = await encryptBlob([{ id: 'local', op_timestamp: 't' }]);
    const remoteBlob = await encryptBlob([{ id: 'remote', op_timestamp: 't' }], 10);
    const wrongKey = wrapKey(new Uint8Array(32).fill(9));

    const vault = makeVault(localBlob);

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({ status: 200, ...remoteBlob })),
    };

    await pullRemoteVaultPartitions({
      vault,
      http,
      verifyDecrypt: { kek: wrongKey, crypto: { encrypt, decrypt } },
    });

    expect(vault.writePartition).not.toHaveBeenCalled();
  });
});

describe('probeKekAgainstVaultData', () => {
  it('rejects a KEK that decrypts remote data but not a local partition', async () => {
    const localKey = wrapKey(new Uint8Array(32).fill(1));
    const remoteKey = wrapKey(new Uint8Array(32).fill(2));
    const localBlob = await encryptBlob([{ id: 'med', op_timestamp: 't' }], 1, localKey);
    const remoteBlob = await encryptBlob([{ id: 'sym', op_timestamp: 't' }], 1, remoteKey);

    const vault = makeVault(localBlob);
    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async (vaultType) => {
        if (vaultType === 'symptoms') {
          return { status: 200, ...remoteBlob };
        }
        return { status: 404 };
      }),
    };

    expect(
      await probeKekAgainstVaultData({
        vault,
        http,
        kek: remoteKey,
        crypto: { decrypt },
      }),
    ).toBe(false);

    expect(
      await probeKekAgainstVaultData({
        vault,
        http,
        kek: localKey,
        crypto: { decrypt },
      }),
    ).toBe(false);

    const matchingBlob = await encryptBlob([{ id: 'sym', op_timestamp: 't' }], 1, KEY);
    const vaultBoth = makeVault(await encryptBlob([{ id: 'med', op_timestamp: 't' }], 1, KEY));
    const httpBoth: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({ status: 200, ...matchingBlob })),
    };
    expect(
      await probeKekAgainstVaultData({
        vault: vaultBoth,
        http: httpBoth,
        kek: KEY,
        crypto: { decrypt },
      }),
    ).toBe(true);
  });
});
