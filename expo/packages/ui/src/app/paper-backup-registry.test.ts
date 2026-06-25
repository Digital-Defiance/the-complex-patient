import { describe, expect, it } from 'vitest';
import { wrapKey } from '@complex-patient/crypto-engine';
import {
  listRegisteredPaperBackups,
  registerPaperBackupMnemonic,
  rekeyPaperBackupRegistry,
  unregisterPaperBackupMnemonic,
} from './paper-backup-registry';

function makeStorage() {
  const storage = new Map<string, string>();
  return {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: async (k: string) => {
      storage.delete(k);
    },
  };
}

describe('paper-backup-registry', () => {
  it('registers and unregisters mnemonics encrypted with KEK', async () => {
    const flagStorage = makeStorage();
    const kek = wrapKey(new Uint8Array(32).fill(7));

    await registerPaperBackupMnemonic(flagStorage, kek, {
      backupId: 'backup-1',
      mnemonic: 'abandon '.repeat(23).trim() + 'about',
    });
    const entries = await listRegisteredPaperBackups(flagStorage, kek);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.backupId).toBe('backup-1');

    await unregisterPaperBackupMnemonic(flagStorage, kek, 'backup-1');
    expect(await listRegisteredPaperBackups(flagStorage, kek)).toHaveLength(0);
  });

  it('rekeys registry when KEK changes', async () => {
    const flagStorage = makeStorage();
    const oldKek = wrapKey(new Uint8Array(32).fill(1));
    const newKek = wrapKey(new Uint8Array(32).fill(2));
    const mnemonic = 'abandon '.repeat(23).trim() + 'about';

    await registerPaperBackupMnemonic(flagStorage, oldKek, {
      backupId: 'b2',
      mnemonic,
    });
    await rekeyPaperBackupRegistry(flagStorage, oldKek, newKek);

    expect(await listRegisteredPaperBackups(flagStorage, oldKek)).toHaveLength(0);
    const rekeyed = await listRegisteredPaperBackups(flagStorage, newKek);
    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0]?.mnemonic).toBe(mnemonic);
  });
});
