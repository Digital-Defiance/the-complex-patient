/**
 * @complex-patient/key-store — Shared idle auto-lock
 *
 * A single idle timer drives the 300s auto-lock on every platform
 * (Requirement 3.7). On expiry it discards the in-memory KEK and locks the
 * vault by invoking the platform `lock()`; after locking, the vault requires
 * Master_Passphrase re-entry before any decrypt (Requirement 3.8).
 *
 * The timer is reset on every user interaction (`notifyActivity`). The
 * underlying timer is injected via {@link TimerScheduler} so tests can use fake
 * timers instead of real wall-clock time.
 */

import {
  DEFAULT_IDLE_TIMEOUT_MS,
  type TimerHandle,
  type TimerScheduler,
} from './types';

/** A default {@link TimerScheduler} backed by the host `setTimeout`. */
export const systemTimerScheduler: TimerScheduler = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface IdleAutoLockOptions {
  /** Idle window before auto-lock fires. Defaults to 300_000ms (3.7). */
  timeoutMs?: number;
  /** Timer backend. Defaults to {@link systemTimerScheduler}. */
  scheduler?: TimerScheduler;
}

/**
 * Drives the shared idle auto-lock. The controller is platform-agnostic: it
 * calls back into the provided `onIdleLock` (which discards the KEK and locks
 * the vault) when the idle window elapses with no activity.
 */
export class IdleAutoLock {
  private readonly timeoutMs: number;
  private readonly scheduler: TimerScheduler;
  private readonly onIdleLock: () => void;
  private handle: TimerHandle | null = null;
  private running = false;

  constructor(onIdleLock: () => void, options: IdleAutoLockOptions = {}) {
    this.onIdleLock = onIdleLock;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.scheduler = options.scheduler ?? systemTimerScheduler;
  }

  /** Begin (or restart) the idle countdown. Called on unlock. */
  start(): void {
    this.running = true;
    this.arm();
  }

  /**
   * Reset the idle countdown in response to user interaction (Requirement 3.7).
   * No-op while not running (i.e., when the vault is already locked) so a
   * stray interaction event cannot revive a locked session.
   */
  notifyActivity(): void {
    if (!this.running) {
      return;
    }
    this.arm();
  }

  /** Cancel the countdown without firing. Called on explicit lock. */
  stop(): void {
    this.running = false;
    this.disarm();
  }

  /** Whether the idle countdown is currently active. */
  isRunning(): boolean {
    return this.running;
  }

  private arm(): void {
    this.disarm();
    this.handle = this.scheduler.setTimeout(() => {
      this.handle = null;
      this.running = false;
      this.onIdleLock();
    }, this.timeoutMs);
  }

  private disarm(): void {
    if (this.handle !== null) {
      this.scheduler.clearTimeout(this.handle);
      this.handle = null;
    }
  }
}
