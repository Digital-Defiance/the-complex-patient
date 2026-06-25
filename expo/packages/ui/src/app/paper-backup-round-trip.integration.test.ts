import { describe, expect, it, vi } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, deriveKEK, generateSalt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import { WebSessionKeyStore } from '@complex-patient/key-store';
import { createVaultStore } from '../store/vault-store';
import { createAuthProvider } from './auth';
import { createHomeEntry } from './home-entry';
import type { KdfMaterial } from './kdf-material-sync';
import { kdfMaterialFromPayload } from './kdf-material-sync';
import type { PaperBackupCreatePayload } from './vault-http-client';

const PBKDF2_PARAMS = { algorithm: 'PBKDF2' as const, pbkdf2Iterations: 600_000 };

function keyBytes(kek: CryptoKeyRef): Uint8Array {
  return kek._inner as Uint8Array;
}

function makeFlagStorage() {
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

type StoredEnvelope = Omit<PaperBackupCreatePayload, 'backup_id'>;

function fakeWorker() {
  return {
    enqueue: vi.fn(),
    syncPartition: vi.fn(async () => ({ status: 'synced' as const, newVersion: 1 })),
    onConnectivityRestored: vi.fn(),
  };
}

function makePaperBackupHttp() {
  const envelopes = new Map<string, StoredEnvelope>();
  let publishedMaterial: KdfMaterial | null = null;

  return {
    envelopes,
    getPublishedMaterial: () => publishedMaterial,
    vaultHttp: {
      getKdfMaterial: vi.fn(async () => {
        if (!publishedMaterial) return { status: 404 };
        return {
          status: 200,
          salt_base64: Buffer.from(publishedMaterial.salt).toString('base64'),
          params: publishedMaterial.params,
        };
      }),
      putKdfMaterial: vi.fn(async (payload: { salt_base64: string; params: KdfMaterial['params'] }) => {
        publishedMaterial = kdfMaterialFromPayload(payload);
        return { status: 200 };
      }),
      postVault: vi.fn(),
      getVault: vi.fn(),
      registerDevice: vi.fn(async () => ({ status: 200 })),
      unregisterDevice: vi.fn(async () => ({ status: 200 })),
      listPaperBackups: vi.fn(async () => ({
        status: 200,
        backups: [...envelopes.entries()].map(([backup_id, entry]) => ({
          backup_id,
          label: entry.label ?? null,
          created_at: new Date().toISOString(),
        })),
      })),
      createPaperBackup: vi.fn(async (payload: PaperBackupCreatePayload) => {
        envelopes.set(payload.backup_id, {
          label: payload.label,
          iv: payload.iv,
          auth_tag: payload.auth_tag,
          ciphertext: payload.ciphertext,
        });
        return { status: 201 };
      }),
      getPaperBackup: vi.fn(async (backupId: string) => {
        const envelope = envelopes.get(backupId);
        if (!envelope) return { status: 404 };
        return {
          status: 200,
          backup_id: backupId,
          iv: envelope.iv,
          auth_tag: envelope.auth_tag,
          ciphertext: envelope.ciphertext,
        };
      }),
      revokePaperBackup: vi.fn(async (backupId: string) => {
        envelopes.delete(backupId);
        return { status: 200 };
      }),
      updatePaperBackup: vi.fn(async (backupId: string, payload: Omit<PaperBackupCreatePayload, 'backup_id' | 'label'>) => {
        const existing = envelopes.get(backupId);
        if (!existing) return { status: 404 };
        envelopes.set(backupId, { ...existing, ...payload });
        return { status: 200 };
      }),
    },
  };
}

async function deriveMaterial(passphrase: string): Promise<KdfMaterial & { kek: CryptoKeyRef }> {
  const salt = await generateSalt();
  const derived = await deriveKEK(passphrase, salt, PBKDF2_PARAMS);
  if (!derived.ok) {
    throw new Error(`derive failed: ${derived.error}`);
  }
  return { salt, params: PBKDF2_PARAMS, kek: derived.kek };
}

describe('paper backup create → recover round trip', () => {
  it('creates a backup, clears session KEK, and recovers with mnemonic', async () => {
    const passphrase = 'correct-horse-battery-staple';
    const { salt, params, kek } = await deriveMaterial(passphrase);
    const material: KdfMaterial = { salt, params };

    const keyStore = new WebSessionKeyStore();
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });
    const flagStorage = makeFlagStorage();
    const { vaultHttp } = makePaperBackupHttp();

    const controller = createHomeEntry({
      keyStore,
      store,
      syncWorker: fakeWorker(),
      auth: createAuthProvider(),
      vaultHttp,
      getActiveKek: () => keyStore.getKek(),
      paperBackupRegistryStorage: flagStorage,
    });

    await controller.signIn({ kind: 'jwt', token: 'jwt' });
    const unlock = await controller.unlockWithKek(kek);
    expect(unlock).toEqual({ ok: true, status: 'ready' });

    const created = await controller.createPaperBackup(material, 'Recovery sheet');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.backupId).toBeTruthy();
    expect(created.mnemonic.split(' ')).toHaveLength(24);
    expect(created.qrDataUrl).toMatch(/^data:image/);

    await keyStore.lock();
    expect(keyStore.getKek()).toBeNull();

    const recovered = await controller.recoverWithPaperBackup(
      created.mnemonic,
      created.backupId,
      async () => {},
    );
    expect(recovered).toEqual({ ok: true, status: 'ready' });
    expect(Buffer.from(keyBytes(keyStore.getKek()!)).equals(Buffer.from(keyBytes(kek)))).toBe(true);
  });

  it('re-wraps paper backups after passphrase change and recovery still works', async () => {
    const oldPass = 'old-passphrase-here';
    const newPass = 'new-passphrase-here';
    const oldVault = await deriveMaterial(oldPass);
    const oldMaterial: KdfMaterial = { salt: oldVault.salt, params: oldVault.params };

    const keyStore = new WebSessionKeyStore();
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });
    const flagStorage = makeFlagStorage();
    const { vaultHttp, getPublishedMaterial } = makePaperBackupHttp();

    const controller = createHomeEntry({
      keyStore,
      store,
      syncWorker: fakeWorker(),
      auth: createAuthProvider(),
      vaultHttp,
      getActiveKek: () => keyStore.getKek(),
      paperBackupRegistryStorage: flagStorage,
    });

    await controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(oldVault.kek);

    const created = await controller.createPaperBackup(oldMaterial);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const changeResult = await controller.changeMasterPassphrase(
      newPass,
      oldMaterial,
      async () => {},
    );
    expect(changeResult).toEqual({ ok: true, rewrappedBackups: 1 });
    expect(vaultHttp.updatePaperBackup).toHaveBeenCalled();

    await keyStore.lock();

    const recovered = await controller.recoverWithPaperBackup(
      created.mnemonic,
      created.backupId,
      async () => {},
    );
    expect(recovered).toEqual({ ok: true, status: 'ready' });

    const published = getPublishedMaterial();
    expect(published).not.toBeNull();
    const expected = await deriveKEK(newPass, published!.salt, published!.params);
    if (!expected.ok) throw new Error('derive failed');
    expect(Buffer.from(keyBytes(keyStore.getKek()!)).equals(Buffer.from(keyBytes(expected.kek)))).toBe(true);
  });
});
