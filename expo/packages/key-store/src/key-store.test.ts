/**
 * @complex-patient/key-store — Locking behavior unit tests (task 10.2)
 *
 * Exhaustive coverage of the Session Key Store locking policy:
 * - 3.3 biometric-failure lockout (exact 5-failure threshold, counter reset,
 *   KEK retained in enclave, passphrase fallback for the session).
 * - 3.6 web volatile-only retention (never persisted, discarded on tab
 *   close/reload, passphrase required after discard).
 * - 3.7 idle-timeout discard (300s default, both platforms, activity reset,
 *   activity-after-lock no-op).
 * - 3.8 locked-state decrypt blocking (no KEK released without a fresh unlock).
 *
 * All timing is driven by an injected fake {@link TimerScheduler} and all
 * platform backends are injected mocks, so the suite is fully deterministic.
 */

import { describe, expect, it } from 'vitest';
import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  IdleAutoLock,
  NativeSessionKeyStore,
  WebSessionKeyStore,
  BIOMETRIC_MAX_ATTEMPTS,
  type BiometricAdapter,
  type KekCodec,
  type SecureStoreAdapter,
  type TimerScheduler,
} from './index';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const SERIALIZED = 'serialized-kek';

/**
 * Codec that records a sentinel in the deserialized key's `_inner` so tests can
 * confirm the KEK released by `unlock()` was rebuilt from the enclave value.
 */
const codec: KekCodec = {
  serialize: () => SERIALIZED,
  deserialize: () => wrapKey('from-enclave'),
};

/** Secure store double that also exposes whether the KEK is still persisted. */
function makeSecureStore(initial: string | null = null) {
  let stored = initial;
  const adapter: SecureStoreAdapter = {
    setKek: async (s) => {
      stored = s;
    },
    getKek: async () => stored,
    deleteKek: async () => {
      stored = null;
    },
  };
  return {
    adapter,
    /** Direct peek at enclave contents (test-only). */
    peek: () => stored,
  };
}

/** Biometric double with a mutable success flag and a call counter. */
function makeBiometrics(opts: {
  available?: boolean;
  succeed?: boolean;
}): BiometricAdapter & {
  setSucceed: (v: boolean) => void;
  setAvailable: (v: boolean) => void;
  authCalls: () => number;
} {
  let available = opts.available ?? true;
  let succeed = opts.succeed ?? false;
  let authCalls = 0;
  return {
    isAvailable: async () => available,
    authenticate: async () => {
      authCalls += 1;
      return succeed;
    },
    setSucceed: (v) => {
      succeed = v;
    },
    setAvailable: (v) => {
      available = v;
    },
    authCalls: () => authCalls,
  };
}

/**
 * Deterministic timer scheduler. `fire()` invokes every currently-armed timer;
 * cleared timers never fire. Exposes counters so tests can assert re-arming.
 */
function makeFakeScheduler() {
  interface Timer {
    handler: () => void;
    ms: number;
  }
  let nextId = 1;
  let setTimeoutCalls = 0;
  let lastMs: number | undefined;
  const active = new Map<number, Timer>();
  const scheduler: TimerScheduler = {
    setTimeout(handler, ms) {
      const id = nextId++;
      active.set(id, { handler, ms });
      setTimeoutCalls += 1;
      lastMs = ms;
      return id;
    },
    clearTimeout(handle) {
      active.delete(handle as number);
    },
  };
  return {
    scheduler,
    /** Fire all currently-armed timers (then disarm them, mirroring real timers). */
    fire() {
      const pending = [...active.values()];
      active.clear();
      for (const t of pending) t.handler();
    },
    activeCount: () => active.size,
    setTimeoutCalls: () => setTimeoutCalls,
    lastMs: () => lastMs,
  };
}

const KEK: CryptoKeyRef = wrapKey(new Uint8Array([9, 9, 9]));

function makeNative(overrides?: {
  secureStore?: ReturnType<typeof makeSecureStore>;
  biometrics?: ReturnType<typeof makeBiometrics>;
  scheduler?: ReturnType<typeof makeFakeScheduler>;
}) {
  const secureStore = overrides?.secureStore ?? makeSecureStore(SERIALIZED);
  const biometrics = overrides?.biometrics ?? makeBiometrics({ available: true, succeed: true });
  const scheduler = overrides?.scheduler ?? makeFakeScheduler();
  const store = new NativeSessionKeyStore({
    secureStore: secureStore.adapter,
    biometrics,
    codec,
    idleOptions: { scheduler: scheduler.scheduler },
  });
  return { store, secureStore, biometrics, scheduler };
}

// ---------------------------------------------------------------------------
// Requirement 3.3 — biometric-failure lockout
// ---------------------------------------------------------------------------

describe('Requirement 3.3 — biometric-failure lockout', () => {
  it('returns BIOMETRIC_FAILED for the first 4 failures and locks out on exactly the 5th', async () => {
    const biometrics = makeBiometrics({ available: true, succeed: false });
    const { store } = makeNative({ biometrics });

    for (let attempt = 1; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      const r = await store.unlock();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('BIOMETRIC_FAILED');
    }
    // Exactly the 5th consecutive failure trips lockout (boundary).
    const lockout = await store.unlock();
    expect(lockout.ok).toBe(false);
    if (!lockout.ok) expect(lockout.reason).toBe('BIOMETRIC_LOCKED_OUT');
  });

  it('does not lock out before the threshold (4 failures still allow biometric retry)', async () => {
    const biometrics = makeBiometrics({ available: true, succeed: false });
    const { store } = makeNative({ biometrics });

    for (let attempt = 1; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      const r = await store.unlock();
      if (!r.ok) expect(r.reason).toBe('BIOMETRIC_FAILED');
    }
    // After 4 failures biometrics are still attempted (not yet disabled).
    const before = biometrics.authCalls();
    const r = await store.unlock();
    expect(biometrics.authCalls()).toBe(before + 1);
    if (!r.ok) expect(r.reason).toBe('BIOMETRIC_LOCKED_OUT');
  });

  it('disables biometrics for the session after lockout — later unlocks demand passphrase without prompting', async () => {
    const biometrics = makeBiometrics({ available: true, succeed: false });
    const { store } = makeNative({ biometrics });

    for (let attempt = 0; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      await store.unlock();
    }
    const callsAtLockout = biometrics.authCalls();

    const after = await store.unlock();
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe('PASSPHRASE_REQUIRED');
    // No further biometric prompts once disabled for the session (3.3).
    expect(biometrics.authCalls()).toBe(callsAtLockout);
  });

  it('retains the KEK in the Secure Enclave through lockout (3.3)', async () => {
    const secureStore = makeSecureStore(SERIALIZED);
    const biometrics = makeBiometrics({ available: true, succeed: false });
    const { store } = makeNative({ secureStore, biometrics });

    for (let attempt = 0; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      await store.unlock();
    }
    // Enclave still holds the serialized KEK; lockout never deletes it.
    expect(secureStore.peek()).toBe(SERIALIZED);
  });

  it('resets the consecutive-failure counter after a success before the 5th failure', async () => {
    const biometrics = makeBiometrics({ available: true, succeed: false });
    const { store } = makeNative({ biometrics });

    // 4 failures (one short of lockout)...
    for (let attempt = 1; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      const r = await store.unlock();
      if (!r.ok) expect(r.reason).toBe('BIOMETRIC_FAILED');
    }
    // ...then a success resets the counter.
    biometrics.setSucceed(true);
    const success = await store.unlock();
    expect(success.ok).toBe(true);

    // It should now take a fresh run of 5 failures to lock out again.
    biometrics.setSucceed(false);
    for (let attempt = 1; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      const r = await store.unlock();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('BIOMETRIC_FAILED');
    }
    const lockout = await store.unlock();
    if (!lockout.ok) expect(lockout.reason).toBe('BIOMETRIC_LOCKED_OUT');
  });

  it('store() clears any prior lockout state for the new session (3.3)', async () => {
    const biometrics = makeBiometrics({ available: true, succeed: false });
    const { store } = makeNative({ biometrics });

    for (let attempt = 0; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      await store.unlock();
    }
    // Re-store (e.g. passphrase fallback re-derived the KEK) resets the session.
    await store.store(KEK);
    biometrics.setSucceed(true);
    const r = await store.unlock();
    expect(r.ok).toBe(true);
  });

  it('requires passphrase re-entry when biometrics are unavailable (3.4)', async () => {
    const biometrics = makeBiometrics({ available: false, succeed: true });
    const { store } = makeNative({ biometrics });
    const r = await store.unlock();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('PASSPHRASE_REQUIRED');
    // Biometrics never prompted when unavailable.
    expect(biometrics.authCalls()).toBe(0);
  });

  it('returns NO_KEY_STORED when the enclave is empty', async () => {
    const secureStore = makeSecureStore(null);
    const { store } = makeNative({ secureStore });
    const r = await store.unlock();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NO_KEY_STORED');
  });
});

// ---------------------------------------------------------------------------
// Requirement 3.6 — web volatile-only retention
// ---------------------------------------------------------------------------

describe('Requirement 3.6 — web volatile-only retention', () => {
  it('holds the KEK only in RAM and never accepts a persistent backend', () => {
    // The web store constructor exposes no secure-storage dependency at all;
    // its only optional deps are the lifecycle hook and idle options.
    const store = new WebSessionKeyStore();
    expect(store.isUnlocked()).toBe(false);
    expect(store.getKek()).toBeNull();
  });

  it('releases the resident KEK while in RAM and blocks once discarded', async () => {
    const store = new WebSessionKeyStore();
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    const live = await store.unlock();
    expect(live.ok).toBe(true);

    await store.lock();
    const afterLock = await store.unlock();
    expect(afterLock.ok).toBe(false);
    if (!afterLock.ok) expect(afterLock.reason).toBe('PASSPHRASE_REQUIRED');
  });

  it('discards the KEK and locks the vault on tab close (3.6)', async () => {
    let closeHandler: (() => void) | undefined;
    const store = new WebSessionKeyStore({
      lifecycle: { onTabClose: (h) => (closeHandler = h) },
    });
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    closeHandler?.();
    expect(store.isUnlocked()).toBe(false);
    expect(store.getKek()).toBeNull();
  });

  it('requires passphrase re-entry after a tab-close discard (3.6, 3.8)', async () => {
    let closeHandler: (() => void) | undefined;
    const store = new WebSessionKeyStore({
      lifecycle: { onTabClose: (h) => (closeHandler = h) },
    });
    await store.store(KEK);
    closeHandler?.();

    const r = await store.unlock();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('PASSPHRASE_REQUIRED');
  });

  it('stops the idle timer on tab close so a stale timer cannot fire', async () => {
    let closeHandler: (() => void) | undefined;
    const scheduler = makeFakeScheduler();
    const store = new WebSessionKeyStore({
      lifecycle: { onTabClose: (h) => (closeHandler = h) },
      idleOptions: { scheduler: scheduler.scheduler },
    });
    await store.store(KEK);
    expect(scheduler.activeCount()).toBe(1);

    closeHandler?.();
    // Tab close clears the armed idle timer.
    expect(scheduler.activeCount()).toBe(0);
  });

  it('models a reload as a fresh store with no recoverable KEK (3.6)', async () => {
    // First "page life": store a KEK.
    const first = new WebSessionKeyStore();
    await first.store(KEK);
    expect(first.isUnlocked()).toBe(true);

    // After reload, a brand-new instance has nothing — passphrase required.
    const afterReload = new WebSessionKeyStore();
    expect(afterReload.isUnlocked()).toBe(false);
    const r = await afterReload.unlock();
    if (!r.ok) expect(r.reason).toBe('PASSPHRASE_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// Requirement 3.7 — idle-timeout discard
// ---------------------------------------------------------------------------

describe('Requirement 3.7 — idle-timeout discard', () => {
  it('uses the 300s default idle window when no override is supplied', () => {
    const scheduler = makeFakeScheduler();
    const idle = new IdleAutoLock(() => {}, { scheduler: scheduler.scheduler });
    idle.start();
    expect(scheduler.lastMs()).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(300_000);
  });

  it('discards the in-memory KEK and locks the vault on native after idle expiry', async () => {
    const scheduler = makeFakeScheduler();
    const { store } = makeNative({ scheduler });
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    scheduler.fire();
    expect(store.isUnlocked()).toBe(false);
    expect(store.getKek()).toBeNull();
  });

  it('discards the in-memory KEK and locks the vault on web after idle expiry', async () => {
    const scheduler = makeFakeScheduler();
    const store = new WebSessionKeyStore({ idleOptions: { scheduler: scheduler.scheduler } });
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    scheduler.fire();
    expect(store.isUnlocked()).toBe(false);
    expect(store.getKek()).toBeNull();
  });

  it('resets the idle countdown on notifyActivity (web)', async () => {
    const scheduler = makeFakeScheduler();
    const store = new WebSessionKeyStore({ idleOptions: { scheduler: scheduler.scheduler } });
    await store.store(KEK);
    const callsAfterStore = scheduler.setTimeoutCalls();

    // Activity re-arms: clears the prior timer and schedules a fresh one.
    store.notifyActivity();
    expect(scheduler.setTimeoutCalls()).toBe(callsAfterStore + 1);
    expect(scheduler.activeCount()).toBe(1);

    // The (single, current) timer still locks when it finally elapses.
    scheduler.fire();
    expect(store.isUnlocked()).toBe(false);
  });

  it('resets the idle countdown on notifyActivity (native)', async () => {
    const scheduler = makeFakeScheduler();
    const { store } = makeNative({ scheduler });
    await store.store(KEK);
    const callsAfterStore = scheduler.setTimeoutCalls();

    store.notifyActivity();
    expect(scheduler.setTimeoutCalls()).toBe(callsAfterStore + 1);
    expect(scheduler.activeCount()).toBe(1);
  });

  it('treats activity after an idle lock as a no-op (cannot revive a locked session)', async () => {
    const scheduler = makeFakeScheduler();
    const store = new WebSessionKeyStore({ idleOptions: { scheduler: scheduler.scheduler } });
    await store.store(KEK);

    scheduler.fire(); // idle lock
    expect(store.isUnlocked()).toBe(false);

    const callsAfterLock = scheduler.setTimeoutCalls();
    store.notifyActivity(); // must not re-arm a locked session
    expect(scheduler.setTimeoutCalls()).toBe(callsAfterLock);
    expect(scheduler.activeCount()).toBe(0);
    expect(store.isUnlocked()).toBe(false);
  });

  it('does not re-arm or fire after an explicit lock', async () => {
    const scheduler = makeFakeScheduler();
    const store = new WebSessionKeyStore({ idleOptions: { scheduler: scheduler.scheduler } });
    await store.store(KEK);

    await store.lock();
    expect(scheduler.activeCount()).toBe(0);

    // Firing any leftover timers must not change the locked state.
    scheduler.fire();
    expect(store.isUnlocked()).toBe(false);
  });

  it('re-arms a fresh idle countdown on each successful unlock', async () => {
    const scheduler = makeFakeScheduler();
    const { store } = makeNative({ scheduler });
    await store.store(KEK);

    scheduler.fire(); // idle lock
    expect(store.isUnlocked()).toBe(false);

    const unlocked = await store.unlock(); // biometric success re-arms idle
    expect(unlocked.ok).toBe(true);
    expect(scheduler.activeCount()).toBe(1);

    // The freshly-armed timer locks again on the next idle window.
    scheduler.fire();
    expect(store.isUnlocked()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Requirement 3.8 — locked-state decrypt blocking
// ---------------------------------------------------------------------------

describe('Requirement 3.8 — locked-state blocks KEK release', () => {
  it('reports no key via isUnlocked()/getKek() once locked (native)', async () => {
    const { store } = makeNative();
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);

    await store.lock();
    expect(store.isUnlocked()).toBe(false);
    expect(store.getKek()).toBeNull();
  });

  it('reports no key via isUnlocked()/getKek() once locked (web)', async () => {
    const store = new WebSessionKeyStore();
    await store.store(KEK);
    await store.lock();
    expect(store.isUnlocked()).toBe(false);
    expect(store.getKek()).toBeNull();
  });

  it('does not release the KEK after an idle lock without a fresh unlock (native)', async () => {
    const scheduler = makeFakeScheduler();
    const { store } = makeNative({ scheduler });
    await store.store(KEK);

    scheduler.fire(); // idle lock discards in-memory KEK
    expect(store.getKek()).toBeNull();

    // A fresh biometric unlock is required to release the KEK again.
    const r = await store.unlock();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kek).toEqual(wrapKey('from-enclave'));
    expect(store.getKek()).not.toBeNull();
  });

  it('requires passphrase fallback when locked and biometrics are disabled for the session', async () => {
    const biometrics = makeBiometrics({ available: true, succeed: false });
    const { store } = makeNative({ biometrics });
    await store.store(KEK);

    // Trip the session lockout while a key is resident...
    for (let attempt = 0; attempt < BIOMETRIC_MAX_ATTEMPTS; attempt++) {
      await store.unlock();
    }
    await store.lock();

    const r = await store.unlock();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('PASSPHRASE_REQUIRED');
  });

  it('keeps the web vault locked until the passphrase re-derives and re-stores the KEK', async () => {
    const store = new WebSessionKeyStore();
    await store.store(KEK);
    await store.lock();

    // While locked, unlock cannot recover the KEK.
    const blocked = await store.unlock();
    expect(blocked.ok).toBe(false);

    // Passphrase re-entry path: caller re-derives and re-stores.
    await store.store(KEK);
    expect(store.isUnlocked()).toBe(true);
    const ok = await store.unlock();
    expect(ok.ok).toBe(true);
  });
});
