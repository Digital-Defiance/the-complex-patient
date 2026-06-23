/**
 * Merge-aware partition reconciliation tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { encrypt, decrypt, wrapKey } from '@complex-patient/crypto-engine';
import type { LocalVault } from '@complex-patient/local-vault';
import { reconcilePartitionWithRemote } from './partition-reconcile';

const KEY = wrapKey(new Uint8Array(32).fill(3));

async function encryptBlob(records: unknown[], syncVersion = 1) {
  const payload = await encrypt(
    new TextEncoder().encode(JSON.stringify({ records })),
    KEY,
  );
  return {
    sync_version: syncVersion,
    iv: payload.iv,
    auth_tag: payload.authTag,
    ciphertext: payload.ciphertext,
  };
}

function makeVault(initial: {
  partition?: Awaited<ReturnType<typeof encryptBlob>> | null;
  base?: Awaited<ReturnType<typeof encryptBlob>> | null;
}) {
  let partition = initial.partition ?? null;
  let base = initial.base ?? null;
  return {
    readPartition: vi.fn(async () => partition),
    writePartition: vi.fn(async (_vt, blob) => {
      partition = blob;
    }),
    readBase: vi.fn(async () => base),
    setBase: vi.fn(async (_vt, blob) => {
      base = blob;
    }),
    getPartition: () => partition,
    getBase: () => base,
  } as unknown as LocalVault & {
    getPartition: () => typeof partition;
    getBase: () => typeof base;
  };
}

describe('reconcilePartitionWithRemote', () => {
  it('adopts remote when local partition is absent', async () => {
    const remote = await encryptBlob([{ id: 'remote', op_timestamp: 't' }], 2);
    const vault = makeVault({ partition: null });

    const outcome = await reconcilePartitionWithRemote('symptoms', remote, {
      vault,
      crypto: { encrypt, decrypt },
      kek: KEY,
    });

    expect(outcome).toEqual({ status: 'applied', syncVersion: 2, needsPush: false });
    expect(vault.getPartition()).toEqual(remote);
    expect(vault.getBase()).toEqual(remote);
  });

  it('leaves newer local version unchanged', async () => {
    const local = await encryptBlob([{ id: 'local', op_timestamp: 't' }], 5);
    const remote = await encryptBlob([{ id: 'remote', op_timestamp: 't' }], 2);
    const vault = makeVault({ partition: local });

    const outcome = await reconcilePartitionWithRemote('symptoms', remote, {
      vault,
      crypto: { encrypt, decrypt },
      kek: KEY,
    });

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(vault.writePartition).not.toHaveBeenCalled();
  });

  it('merges local and remote records when remote version is ahead', async () => {
    const local = await encryptBlob([{ id: 'local-only', op_timestamp: '2026-01-02T00:00:00Z' }], 5);
    const remote = await encryptBlob([{ id: 'remote-only', op_timestamp: '2026-01-01T00:00:00Z' }], 6);
    const vault = makeVault({ partition: local, base: null });

    const outcome = await reconcilePartitionWithRemote('symptoms', remote, {
      vault,
      crypto: { encrypt, decrypt },
      kek: KEY,
    });

    expect(outcome).toEqual({ status: 'applied', syncVersion: 6, needsPush: true });
    expect(vault.getBase()).toEqual(remote);

    const merged = vault.getPartition();
    expect(merged?.sync_version).toBe(6);

    const decryptResult = await decrypt(
      { iv: merged!.iv, authTag: merged!.auth_tag, ciphertext: merged!.ciphertext },
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

  it('does not require push when merged result matches remote', async () => {
    const remote = await encryptBlob([{ id: 'only-remote', op_timestamp: 't' }], 6);
    const local = await encryptBlob([], 5);
    const vault = makeVault({ partition: local, base: await encryptBlob([], 4) });

    const outcome = await reconcilePartitionWithRemote('symptoms', remote, {
      vault,
      crypto: { encrypt, decrypt },
      kek: KEY,
    });

    expect(outcome).toEqual({ status: 'applied', syncVersion: 6, needsPush: false });
  });
});
