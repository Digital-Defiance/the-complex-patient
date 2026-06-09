import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { VaultRecord } from '@complex-patient/domain';
import { createVaultStore, type VaultStore } from './vault-store';
import { bindStoreToLock } from './lock-binding';
import type { VaultStoreCrypto } from './types';

/**
 * Unit/integration tests for the Zustand-style vault store (Task 15.1).
 *
 * These exercise the REAL Crypto_Engine (AES-256-GCM via node:crypto) and the
 * REAL EncryptedLocalVault over an in-memory backend — no mocks — so they
 * validate the actual hydrate (decrypt) → commit (encrypt → persist → reflect)
 * → clear round-trip.
 *
 * Coverage:
 * - hydrate-on-unlock decrypts existing partitions and populates projections (5.1, 5.2)
 * - write-through persists to the Local_Vault BEFORE reflecting committed state (5.1, 5.4)
 * - clear-on-lock wipes PHI projections together with the KEK (3.6, 3.7)
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(7));
const crypto: VaultStoreCrypto = { encrypt, decrypt };

interface SymptomRec extends VaultRecord {
  symptomType: string;
}

const utf8 = new TextEncoder();

/** Seed the medications partition with a known record set at a given version. */
async function seedPartition(
  vault: LocalVault,
  vaultType: 'medications' | 'symptoms',
  records: VaultRecord[],
  syncVersion: number,
): Promise<void> {
  const payload = utf8.encode(JSON.stringify({ records }));
  const enc = await encrypt(payload, KEY);
  await vault.writePartition(vaultType, {
    sync_version: syncVersion,
    iv: enc.iv,
    auth_tag: enc.authTag,
    ciphertext: enc.ciphertext,
  });
}

describe('createVaultStore — hydrate on unlock', () => {
  let vault: LocalVault;
  let store: VaultStore;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    store = createVaultStore({ vault, crypto });
  });

  it('starts locked with empty projections and no KEK', () => {
    expect(store.isUnlocked()).toBe(false);
    expect(store.getState().status).toBe('locked');
    expect(store.getState().partitions.medications.records).toEqual([]);
  });

  it('decrypts and populates projections from existing partitions (5.1, 5.2)', async () => {
    const meds: VaultRecord[] = [
      { id: 'm1', op_timestamp: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', op_timestamp: '2026-01-02T00:00:00.000Z' },
    ];
    const symptoms: SymptomRec[] = [
      { id: 's1', op_timestamp: '2026-01-03T00:00:00.000Z', symptomType: 'fatigue' },
    ];
    await seedPartition(vault, 'medications', meds, 3);
    await seedPartition(vault, 'symptoms', symptoms, 1);

    await store.hydrate(KEY);

    expect(store.isUnlocked()).toBe(true);
    expect(store.getState().status).toBe('unlocked');
    expect(store.getPartition('medications').records).toEqual(meds);
    // sync_version of the source blob is preserved for write-through (R7).
    expect(store.getPartition('medications').syncVersion).toBe(3);
    expect(store.getPartition<SymptomRec>('symptoms').records).toEqual(symptoms);
    // Partitions with no stored blob hydrate as empty at version 0.
    expect(store.getPartition('conditions').records).toEqual([]);
    expect(store.getPartition('conditions').syncVersion).toBe(0);
  });

  it('throws on a tampered/undecryptable blob rather than projecting empty (5.1)', async () => {
    await seedPartition(vault, 'medications', [{ id: 'm1', op_timestamp: 't' }], 1);
    // Corrupt the stored ciphertext.
    const blob = await vault.readPartition('medications');
    await vault.writePartition('medications', {
      ...blob!,
      ciphertext: Buffer.from('garbage-ciphertext').toString('base64'),
    });

    await expect(store.hydrate(KEY)).rejects.toThrow(/failed to decrypt medications/);
  });
});

describe('createVaultStore — write-through commit', () => {
  let vault: LocalVault;
  let store: VaultStore;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
  });

  it('persists to the Local_Vault and reflects committed state (5.4)', async () => {
    const rec: VaultRecord = { id: 'm1', op_timestamp: '2026-01-01T00:00:00.000Z' };

    const result = await store.commit('medications', (cur) => [...cur, rec]);
    expect(result.ok).toBe(true);

    // In-memory projection reflects the committed change.
    expect(store.getPartition('medications').records).toEqual([rec]);

    // The change is durably readable from the Local_Vault by decrypting the blob.
    const blob = await vault.readPartition('medications');
    expect(blob).not.toBeNull();
    const dec = await decrypt(
      { iv: blob!.iv, authTag: blob!.auth_tag, ciphertext: blob!.ciphertext },
      KEY,
    );
    expect(dec.ok).toBe(true);
    if (dec.ok) {
      const parsed = JSON.parse(new TextDecoder().decode(dec.plaintext));
      expect(parsed.records).toEqual([rec]);
    }
  });

  it('persists to the vault BEFORE the projection reflects the change', async () => {
    const rec: VaultRecord = { id: 'm1', op_timestamp: 't' };

    // Wrap the vault write so we can observe state at the moment of persistence.
    let projectionAtPersistTime: VaultRecord[] | null = null;
    const spyingVault = {
      readPartition: vault.readPartition.bind(vault),
      writePartition: async (vt: 'medications' | 'symptoms' | 'conditions' | 'flares' | 'associations', blob: { sync_version: number; iv: string; auth_tag: string; ciphertext: string }) => {
        // At the instant of persistence the in-memory projection must NOT yet
        // reflect the new record (write-through ordering, Requirement 5.4).
        projectionAtPersistTime = spyStore.getPartition('medications').records.slice();
        await vault.writePartition(vt, blob);
      },
    };
    const spyStore = createVaultStore({ vault: spyingVault as never, crypto });
    await spyStore.hydrate(KEY);

    await spyStore.commit('medications', (cur) => [...cur, rec]);

    expect(projectionAtPersistTime).toEqual([]);
    expect(spyStore.getPartition('medications').records).toEqual([rec]);
  });

  it('leaves the projection unchanged when persistence fails (no divergence, 5.1)', async () => {
    const failingVault = {
      readPartition: vault.readPartition.bind(vault),
      writePartition: async () => {
        throw new Error('disk full');
      },
    };
    const failStore = createVaultStore({ vault: failingVault as never, crypto });
    await failStore.hydrate(KEY);

    const result = await failStore.commit('medications', (cur) => [
      ...cur,
      { id: 'x', op_timestamp: 't' },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PERSIST_FAILED');
    }
    // Projection must remain unchanged — store never diverges from the vault.
    expect(failStore.getPartition('medications').records).toEqual([]);
  });

  it('rejects commits while locked (3.8)', async () => {
    store.clear();
    const result = await store.commit('medications', (cur) => [
      ...cur,
      { id: 'x', op_timestamp: 't' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('LOCKED');
    }
  });
});

describe('createVaultStore — clear on lock/idle (3.6, 3.7)', () => {
  let vault: LocalVault;
  let store: VaultStore;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    await seedPartition(vault, 'medications', [{ id: 'm1', op_timestamp: 't' }], 1);
    store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
  });

  it('wipes all PHI projections and discards the KEK', async () => {
    expect(store.isUnlocked()).toBe(true);
    expect(store.getPartition('medications').records).toHaveLength(1);

    store.clear();

    expect(store.isUnlocked()).toBe(false);
    expect(store.getState().status).toBe('locked');
    expect(store.getPartition('medications').records).toEqual([]);
    expect(store.getPartition('medications').syncVersion).toBe(0);
  });

  it('does not destroy the persisted ciphertext at rest (vault is source of truth)', async () => {
    store.clear();
    // The encrypted blob remains in the vault; only the in-memory mirror cleared.
    const blob = await vault.readPartition('medications');
    expect(blob).not.toBeNull();
  });
});

describe('bindStoreToLock — lock clears store + KEK together (3.6, 3.7)', () => {
  it('locks the key store and clears the projections in one step', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    await seedPartition(vault, 'medications', [{ id: 'm1', op_timestamp: 't' }], 1);
    const store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);

    let keyStoreLocked = false;
    const keyStore = {
      lock: async () => {
        keyStoreLocked = true;
      },
    };

    const idleEvents: string[] = [];
    const idle = {
      start: () => idleEvents.push('start'),
      stop: () => idleEvents.push('stop'),
      notifyActivity: () => idleEvents.push('activity'),
    };

    const binding = bindStoreToLock({ store, keyStore, idle });
    binding.startIdleTimer();
    binding.notifyActivity();

    await binding.lock();

    expect(keyStoreLocked).toBe(true);
    expect(store.isUnlocked()).toBe(false);
    expect(store.getPartition('medications').records).toEqual([]);
    expect(idleEvents).toEqual(['start', 'activity', 'stop']);
  });

  it('idle-timeout expiry routed through lock() wipes PHI together with the KEK (3.7)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    await seedPartition(vault, 'symptoms', [{ id: 's1', op_timestamp: 't' }], 1);
    const store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);

    let keyStoreLocked = false;
    const keyStore = { lock: async () => { keyStoreLocked = true; } };

    // Model the IdleAutoLock wiring: its expiry callback invokes binding.lock().
    let fireIdle: (() => void) | null = null;
    const idle = {
      start: () => {},
      stop: () => {},
      notifyActivity: () => {},
    };

    const binding = bindStoreToLock({ store, keyStore, idle });
    // Simulate the IdleAutoLock(() => binding.lock()) expiry.
    fireIdle = () => void binding.lock();

    expect(store.isUnlocked()).toBe(true);
    fireIdle();
    await Promise.resolve();
    await Promise.resolve();

    expect(keyStoreLocked).toBe(true);
    expect(store.isUnlocked()).toBe(false);
    expect(store.getPartition('symptoms').records).toEqual([]);
  });
});
