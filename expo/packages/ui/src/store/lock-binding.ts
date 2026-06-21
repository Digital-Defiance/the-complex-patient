/**
 * @complex-patient/ui — Lock/idle binding for the vault store
 *
 * Wires the {@link VaultStore} clearing to the session lifecycle so that PHI
 * projections are wiped together with the KEK whenever the vault locks — on an
 * explicit lock, on the 300s idle timeout, and (on web) on tab close/reload
 * (Requirements 3.6, 3.7).
 *
 * The binding is intentionally decoupled from `@complex-patient/key-store`'s
 * concrete classes: it accepts a structural `lock()` seam and an optional
 * idle-controller seam, so it composes with either the native or web key store
 * and is testable with fake timers under vitest.
 */

import type { VaultStore } from './vault-store';

/**
 * A platform Session Key Store, narrowed to the `lock` action the binding
 * augments. Calling the bound `lock()` discards the KEK in the key store *and*
 * clears the store's PHI projections in one step (Requirements 3.6, 3.7).
 */
export interface LockableKeyStore {
  lock(): Promise<void>;
  /** Reset the key-store idle countdown on user interaction. */
  notifyActivity?(): void;
  /** Pause idle auto-lock during long-running local operations. */
  suspendIdle?(): void;
  /** Resume idle auto-lock after a suspended operation completes. */
  resumeIdle?(): void;
}

/**
 * The shared idle auto-lock controller (structural match for
 * `@complex-patient/key-store` `IdleAutoLock`). The binding starts it on unlock
 * and stops it on lock so a stray timer cannot fire after the vault is locked.
 */
export interface IdleController {
  start(): void;
  stop(): void;
  notifyActivity(): void;
  suspend?(): void;
  resume?(): void;
}

/** Dependencies for {@link bindStoreToLock}. */
export interface LockBindingDeps {
  store: VaultStore;
  keyStore: LockableKeyStore;
  /** Optional idle auto-lock controller; its expiry must call `lock`. */
  idle?: IdleController;
}

/** The handle returned by {@link bindStoreToLock}. */
export interface LockBinding {
  /**
   * Lock the vault: discard the KEK in the key store and clear all PHI
   * projections together, then stop the idle timer (Requirements 3.6, 3.7).
   * Idempotent and safe to call when already locked.
   */
  lock(): Promise<void>;
  /** Start the idle countdown after a successful unlock + hydrate. */
  startIdleTimer(): void;
  /** Reset the idle countdown on user interaction (Requirement 3.7). */
  notifyActivity(): void;
  /** Pause idle auto-lock during long-running local operations. */
  suspendIdle(): void;
  /** Resume idle auto-lock after a suspended operation completes. */
  resumeIdle(): void;
}

/**
 * Compose a {@link VaultStore} with a platform key store (and optional idle
 * controller) so locking clears PHI state and the KEK together.
 *
 * When an `idle` controller is supplied, its expiry callback is expected to
 * invoke the returned `lock()` (e.g. construct `IdleAutoLock(() => binding.lock())`),
 * which guarantees the 300s idle timeout wipes PHI alongside the KEK
 * (Requirement 3.7).
 */
export function bindStoreToLock(deps: LockBindingDeps): LockBinding {
  const { store, keyStore, idle } = deps;

  async function lock(): Promise<void> {
    // Discard the KEK in the platform key store first, then clear the in-memory
    // PHI projections; both happen as one logical lock step (Requirements 3.6, 3.7).
    await keyStore.lock();
    store.clear();
    idle?.stop();
  }

  function startIdleTimer(): void {
    idle?.start();
  }

  function notifyActivity(): void {
    idle?.notifyActivity();
    keyStore.notifyActivity?.();
  }

  function suspendIdle(): void {
    idle?.suspend?.();
    keyStore.suspendIdle?.();
  }

  function resumeIdle(): void {
    idle?.resume?.();
    keyStore.resumeIdle?.();
  }

  return { lock, startIdleTimer, notifyActivity, suspendIdle, resumeIdle };
}
