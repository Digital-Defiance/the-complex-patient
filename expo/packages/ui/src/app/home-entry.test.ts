import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import {
  NativeSessionKeyStore,
  WebSessionKeyStore,
  type BiometricAdapter,
  type KekCodec,
  type SecureStoreAdapter,
} from '@complex-patient/key-store';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { SyncOutcome } from '@complex-patient/sync-engine';
import { createVaultStore, type VaultStore } from '../store/vault-store';
import type { SyncWorkerLike } from '../store/offline-sync';
import { createHomeEntry, type HomeEntryController } from './home-entry';
import { createAuthProvider, type MutableAuthProvider } from './auth';

/**
 * Integration tests for the shared authenticated-home controller (task 15.3).
 *
 * These wire the REAL Crypto_Engine, the REAL EncryptedLocalVault, the REAL
 * vault store, and the REAL platform key stores (native + web) to prove the
 * SAME shared composition presents the authenticated home on both platforms
 * with identical feature parity (Requirements 22.1, 22.2), gated on the
 * Sync_Backend credential (Requirement 4.1) and the session KEK (Requirement 3).
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(7));

interface MedRec extends VaultRecord {
  drugName: string;
}

const codec: KekCodec = {
  serialize: () => 'serialized-kek',
  deserialize: () => KEY,
};

function makeSecureStore(initial: string | null = null): SecureStoreAdapter {
  let stored = initial;
  return {
    setKek: async (s) => {
      stored = s;
    },
    getKek: async () => stored,
    deleteKek: async () => {
      stored = null;
    },
  };
}

function fakeWorker(outcome: SyncOutcome = { status: 'synced', newVersion: 1 }): SyncWorkerLike & {
  events: string[];
} {
  const events: string[] = [];
  return {
    events,
    enqueue: (v: VaultType) => events.push(`enqueue:${v}`),
    syncPartition: async (v: VaultType) => {
      events.push(`sync:${v}`);
      return outcome;
    },
    onConnectivityRestored: () => events.push('connectivity'),
  };
}

describe('createHomeEntry — auth + unlock lifecycle (4.1, 22.1, 22.2)', () => {
  let vault: LocalVault;
  let store: VaultStore;
  let auth: MutableAuthProvider;
  let controller: HomeEntryController;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    store = createVaultStore({ vault, crypto: { encrypt, decrypt } });
    auth = createAuthProvider();
    const keyStore = new WebSessionKeyStore();
    controller = createHomeEntry({ keyStore, store, syncWorker: fakeWorker(), auth });
  });

  it('starts signed-out before any WordPress credential is set', () => {
    expect(controller.getStatus()).toBe('signed-out');
  });

  it('cannot unlock before signing in to the Sync_Backend (4.1)', async () => {
    const result = await controller.unlockWithKek(KEY);
    expect(result).toEqual({ ok: false, reason: 'NOT_AUTHENTICATED' });
    expect(controller.getStatus()).toBe('signed-out');
  });

  it('becomes locked after sign-in, then ready after KEK unlock (3, 5.2)', async () => {
    await controller.signIn({ kind: 'jwt', token: 'jwt' });
    expect(controller.getStatus()).toBe('locked');

    const result = await controller.unlockWithKek(KEY);
    expect(result).toEqual({ ok: true, status: 'ready' });
    expect(controller.getStatus()).toBe('ready');
  });

  it('sign-out locks the vault and clears the credential (3.6, 4.8)', async () => {
    await controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(KEY);
    expect(controller.getStatus()).toBe('ready');

    await controller.signOut();
    expect(controller.getStatus()).toBe('signed-out');
    expect(store.isUnlocked()).toBe(false);
  });
});

describe('createHomeEntry — offline-first feature surface (5.2, 5.3, 5.4)', () => {
  let controller: HomeEntryController;
  let worker: ReturnType<typeof fakeWorker>;

  beforeEach(async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });
    const auth = createAuthProvider();
    worker = fakeWorker();
    controller = createHomeEntry({
      keyStore: new WebSessionKeyStore(),
      store,
      syncWorker: worker,
      auth,
    });
    await controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(KEY);
  });

  it('commits a write locally and then enqueues a background sync', async () => {
    const result = await controller.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm1', op_timestamp: 't', drugName: 'aspirin' },
    ]);
    expect(result.ok).toBe(true);

    // Local read reflects the committed write without any network.
    expect(controller.read<MedRec>('medications').records).toHaveLength(1);
    // Sync was enqueued after the local persist.
    expect(worker.events[0]).toBe('enqueue:medications');
  });

  it('forwards connectivity restoration to the worker (5.7)', () => {
    controller.onConnectivityRestored();
    expect(worker.events).toContain('connectivity');
  });
});

describe('createHomeEntry — native parity via Secure Enclave key store (22.2, 3.2)', () => {
  it('presents the same ready home through the native key store + biometric unlock', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });
    const auth = createAuthProvider();
    const biometrics: BiometricAdapter = {
      isAvailable: async () => true,
      authenticate: async () => true,
    };
    const keyStore = new NativeSessionKeyStore({
      secureStore: makeSecureStore(),
      biometrics,
      codec,
    });
    const controller = createHomeEntry({ keyStore, store, syncWorker: fakeWorker(), auth });

    await controller.signIn({ kind: 'application-password', username: 'u', applicationPassword: 'p' });
    // First-time KEK establishment stores it in the enclave + hydrates.
    await controller.unlockWithKek(KEY);
    expect(controller.getStatus()).toBe('ready');

    // Re-lock then unlock via the biometric challenge → ready again.
    await controller.lock.lock();
    expect(controller.getStatus()).toBe('locked');

    const result = await controller.unlock();
    expect(result).toEqual({ ok: true, status: 'ready' });
    expect(controller.getStatus()).toBe('ready');

    // A commit works identically to web (feature parity, 22.2).
    const commit = await controller.commit<MedRec>('symptoms', (cur) => [
      ...cur,
      { id: 's1', op_timestamp: 't', drugName: 'n/a' } as MedRec,
    ]);
    expect(commit.ok).toBe(true);
  });

  it('surfaces biometric lockout so the UI can fall back to passphrase (3.3)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });
    const auth = createAuthProvider({ kind: 'jwt', token: 'jwt' });
    const biometrics: BiometricAdapter = {
      isAvailable: async () => true,
      authenticate: async () => false,
    };
    const keyStore = new NativeSessionKeyStore({
      secureStore: makeSecureStore('serialized-kek'),
      biometrics,
      codec,
    });
    const controller = createHomeEntry({ keyStore, store, syncWorker: fakeWorker(), auth });

    let last;
    for (let i = 0; i < 5; i++) {
      last = await controller.unlock();
    }
    expect(last).toEqual({ ok: false, reason: 'BIOMETRIC_LOCKED_OUT' });
    expect(controller.getStatus()).toBe('locked');
  });
});

describe('createHomeEntry — idle auto-lock clears PHI + KEK together (3.7)', () => {
  it('locks via the injected idle controller', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });
    const auth = createAuthProvider({ kind: 'jwt', token: 'jwt' });
    const idle = { start: vi.fn(), stop: vi.fn(), notifyActivity: vi.fn() };
    const controller = createHomeEntry({
      keyStore: new WebSessionKeyStore(),
      store,
      syncWorker: fakeWorker(),
      auth,
      idle,
    });

    await controller.unlockWithKek(KEY);
    expect(idle.start).toHaveBeenCalled();

    controller.notifyActivity();
    expect(idle.notifyActivity).toHaveBeenCalled();

    await controller.lock.lock();
    expect(store.isUnlocked()).toBe(false);
    expect(idle.stop).toHaveBeenCalled();
  });
});
