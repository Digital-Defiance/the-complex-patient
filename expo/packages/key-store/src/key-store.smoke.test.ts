/**
 * @complex-patient/key-store — smoke tests
 *
 * Minimal coverage to confirm the package compiles and the core unlock/lock
 * paths work on both platforms plus the shared idle auto-lock. The exhaustive
 * locking-behavior suite is task 10.2.
 */

import { describe, expect, it, vi } from 'vitest';
import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import {
  IdleAutoLock,
  NativeSessionKeyStore,
  WebSessionKeyStore,
  BIOMETRIC_MAX_ATTEMPTS,
  type BiometricAdapter,
  type KekCodec,
  type SecureStoreAdapter,
  type TimerScheduler,
} from './index';

const codec: KekCodec = {
  serialize: () => 'serialized-kek',
  deserialize: () => wrapKey(new Uint8Array([1, 2, 3])),
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

/** A controllable timer scheduler for deterministic idle-timeout tests. */
function makeManualScheduler(): TimerScheduler & { fire: () => void } {
  const handlers = new Map<number, () => void>();
  let nextId = 1;
  return {
    setTimeout(handler) {
      const id = nextId++;
      handlers.set(id, handler);
      return id;
    },
    clearTimeout(handle) {
      handlers.delete(handle as number);
    },
    fire() {
      for (const handler of handlers.values()) handler();
      handlers.clear();
    },
  };
}

const KEK: CryptoKeyRef = wrapKey(new Uint8Array([9, 9, 9]));

describe('NativeSessionKeyStore', () => {
  it('stores then releases the KEK on biometric success', async () => {
    const biometrics: BiometricAdapter = {
      isAvailable: async () => true,
      authenticate: async () => true,
    };
    const store = new NativeSessionKeyStore({
      secureStore: makeSecureStore(),
      biometrics,
      codec,
    });

    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    await store.lock();
    expect(store.isUnlocked()).toBe(false);

    const result = await store.unlock();
    expect(result.ok).toBe(true);
    expect(store.isUnlocked()).toBe(true);
  });

  it('locks out biometrics after 5 consecutive failures and requires passphrase', async () => {
    const biometrics: BiometricAdapter = {
      isAvailable: async () => true,
      authenticate: async () => false,
    };
    const store = new NativeSessionKeyStore({
      secureStore: makeSecureStore('serialized-kek'),
      biometrics,
      codec,
    });

    for (let i = 1; i < BIOMETRIC_MAX_ATTEMPTS; i++) {
      const r = await store.unlock();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('BIOMETRIC_FAILED');
    }
    const lockout = await store.unlock();
    expect(lockout.ok).toBe(false);
    if (!lockout.ok) expect(lockout.reason).toBe('BIOMETRIC_LOCKED_OUT');

    // Subsequent attempts demand passphrase fallback (3.3).
    const after = await store.unlock();
    if (!after.ok) expect(after.reason).toBe('PASSPHRASE_REQUIRED');
  });

  it('requires passphrase when biometrics are unavailable', async () => {
    const biometrics: BiometricAdapter = {
      isAvailable: async () => false,
      authenticate: async () => true,
    };
    const store = new NativeSessionKeyStore({
      secureStore: makeSecureStore('serialized-kek'),
      biometrics,
      codec,
    });
    const r = await store.unlock();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('PASSPHRASE_REQUIRED');
  });
});

describe('WebSessionKeyStore', () => {
  it('holds the KEK in volatile RAM and discards on lock', async () => {
    const store = new WebSessionKeyStore();
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    const unlocked = await store.unlock();
    expect(unlocked.ok).toBe(true);

    await store.lock();
    expect(store.isUnlocked()).toBe(false);
    const relocked = await store.unlock();
    expect(relocked.ok).toBe(false);
    if (!relocked.ok) expect(relocked.reason).toBe('PASSPHRASE_REQUIRED');
  });

  it('discards the KEK on tab close', async () => {
    let closeHandler: (() => void) | undefined;
    const store = new WebSessionKeyStore({
      lifecycle: { onTabClose: (h) => (closeHandler = h) },
    });
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    closeHandler?.();
    expect(store.isUnlocked()).toBe(false);
  });
});

describe('IdleAutoLock', () => {
  it('fires the lock callback after the idle window elapses', () => {
    const scheduler = makeManualScheduler();
    const onLock = vi.fn();
    const idle = new IdleAutoLock(onLock, { scheduler });

    idle.start();
    expect(idle.isRunning()).toBe(true);
    scheduler.fire();
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(idle.isRunning()).toBe(false);
  });

  it('discards the in-memory KEK on idle timeout for both platforms', async () => {
    const scheduler = makeManualScheduler();
    const web = new WebSessionKeyStore({ idleOptions: { scheduler } });
    await web.store(KEK);
    scheduler.fire();
    expect(web.isUnlocked()).toBe(false);

    const scheduler2 = makeManualScheduler();
    const native = new NativeSessionKeyStore({
      secureStore: makeSecureStore(),
      biometrics: { isAvailable: async () => true, authenticate: async () => true },
      codec,
      idleOptions: { scheduler: scheduler2 },
    });
    await native.store(KEK);
    scheduler2.fire();
    expect(native.isUnlocked()).toBe(false);
  });

  it('does not fire while suspended', () => {
    const scheduler = makeManualScheduler();
    const onLock = vi.fn();
    const idle = new IdleAutoLock(onLock, { scheduler });

    idle.start();
    idle.suspend();
    scheduler.fire();
    expect(onLock).not.toHaveBeenCalled();
    expect(idle.isRunning()).toBe(true);
  });

  it('resumes the countdown after suspend', () => {
    const scheduler = makeManualScheduler();
    const onLock = vi.fn();
    const idle = new IdleAutoLock(onLock, { scheduler });

    idle.start();
    idle.suspend();
    idle.resume();
    scheduler.fire();
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});
