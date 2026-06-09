import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import { IdleAutoLock, DEFAULT_IDLE_TIMEOUT_MS } from '@complex-patient/key-store';
import { createVaultStore } from './vault-store';
import { bindStoreToLock } from './lock-binding';
import type { VaultStoreCrypto } from './types';

/**
 * Integration test (Task 15.1): wire the REAL shared IdleAutoLock controller
 * (Requirement 3.7) to the vault store via bindStoreToLock and assert that the
 * 300s idle timeout discards the KEK and wipes the PHI projections together.
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(9));
const crypto: VaultStoreCrypto = { encrypt, decrypt };
const utf8 = new TextEncoder();

describe('idle auto-lock integration (3.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears PHI + KEK after 300s of inactivity', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const payload = utf8.encode(
      JSON.stringify({ records: [{ id: 'm1', op_timestamp: 't' }] }),
    );
    const enc = await encrypt(payload, KEY);
    await vault.writePartition('medications', {
      sync_version: 1,
      iv: enc.iv,
      auth_tag: enc.authTag,
      ciphertext: enc.ciphertext,
    });

    const store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);

    let keyStoreLocked = false;
    const keyStore = { lock: async () => { keyStoreLocked = true; } };

    // The IdleAutoLock's expiry callback routes through the binding's lock(),
    // which clears the store + KEK together (Requirements 3.6, 3.7).
    let binding!: ReturnType<typeof bindStoreToLock>;
    const idle = new IdleAutoLock(() => void binding.lock());
    binding = bindStoreToLock({ store, keyStore, idle });

    binding.startIdleTimer();
    expect(store.isUnlocked()).toBe(true);

    // Advance to just before the timeout — still unlocked.
    vi.advanceTimersByTime(DEFAULT_IDLE_TIMEOUT_MS - 1);
    expect(store.isUnlocked()).toBe(true);

    // Cross the 300s threshold — idle lock fires.
    vi.advanceTimersByTime(1);
    // Flush the microtasks queued by the async lock().
    await vi.runAllTimersAsync();

    expect(keyStoreLocked).toBe(true);
    expect(store.isUnlocked()).toBe(false);
    expect(store.getPartition('medications').records).toEqual([]);
  });
});
