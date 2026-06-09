/**
 * @complex-patient/key-store — Web Session Key Store
 *
 * The Web_Client retains the KEK only in volatile RAM and never writes it to
 * any persistent storage (Requirement 3.5). On tab close/reload the KEK is
 * discarded and the vault locks (Requirement 3.6). The shared 300s idle timer
 * discards the in-memory KEK and locks the vault (Requirement 3.7). While
 * locked, the KEK is unavailable until the Master_Passphrase is re-entered to
 * re-derive and re-`store` it (Requirements 3.6, 3.8).
 *
 * Because there is no secure persistence on web, `unlock()` cannot recover a
 * discarded KEK; it always signals `PASSPHRASE_REQUIRED` unless the KEK is
 * still resident in memory.
 */

import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import { IdleAutoLock, type IdleAutoLockOptions } from './idle-lock';
import type {
  LifecycleAdapter,
  SessionKeyStore,
  UnlockResult,
} from './types';

export interface WebKeyStoreDeps {
  /** Optional hook to discard the KEK on tab close/reload (Requirement 3.6). */
  lifecycle?: LifecycleAdapter;
  idleOptions?: IdleAutoLockOptions;
}

export class WebSessionKeyStore implements SessionKeyStore {
  /** Volatile, RAM-only KEK; never persisted (Requirement 3.5). */
  private kek: CryptoKeyRef | null = null;
  private readonly idle: IdleAutoLock;

  constructor(deps: WebKeyStoreDeps = {}) {
    this.idle = new IdleAutoLock(() => this.onIdleLock(), deps.idleOptions);
    // Discard the KEK and lock when the tab closes or reloads (3.6).
    deps.lifecycle?.onTabClose(() => {
      this.kek = null;
      this.idle.stop();
    });
  }

  /**
   * Hold the KEK in volatile RAM only and start the idle countdown. No
   * persistent storage is touched (Requirements 3.5, 3.7).
   */
  async store(kek: CryptoKeyRef): Promise<void> {
    this.kek = kek;
    this.idle.start();
  }

  /**
   * If the KEK is still resident in RAM, release it; otherwise the user must
   * re-enter the Master_Passphrase to re-derive it — there is no persistent
   * key store on web (Requirements 3.5, 3.6, 3.8).
   */
  async unlock(): Promise<UnlockResult> {
    if (this.kek !== null) {
      this.idle.start();
      return { ok: true, kek: this.kek };
    }
    return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
  }

  /** Discard the in-memory KEK and stop the idle timer (Requirement 3.6). */
  async lock(): Promise<void> {
    this.kek = null;
    this.idle.stop();
  }

  isUnlocked(): boolean {
    return this.kek !== null;
  }

  /** Reset the idle countdown on user interaction (Requirement 3.7). */
  notifyActivity(): void {
    this.idle.notifyActivity();
  }

  /** Read the resident KEK while unlocked; null once locked (3.8). */
  getKek(): CryptoKeyRef | null {
    return this.kek;
  }

  /** Idle expiry: discard the KEK and lock the vault (Requirements 3.7, 3.8). */
  private onIdleLock(): void {
    this.kek = null;
  }
}
