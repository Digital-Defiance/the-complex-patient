/**
 * @complex-patient/key-store — Web Session Key Store
 *
 * The Web_Client retains the KEK only in volatile RAM during a tab session.
 * Optional passkey unlock stores a PRF-wrapped KEK in localStorage so returning
 * users can skip PBKDF2 re-derivation after tab reload (Requirement 3.6).
 */

import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import { IdleAutoLock, type IdleAutoLockOptions } from './idle-lock';
import type {
  LifecycleAdapter,
  SessionKeyStore,
  UnlockResult,
} from './types';
import {
  clearPasskeyUnlock,
  formatPasskeyUnlockError,
  hasStoredPasskeyUnlock,
  isPasskeyUnlockSupported,
  registerPasskeyUnlock,
  refreshPasskeyUnlockWrap,
  resolveBrowserPasskeyUnlockDeps,
  unlockKekWithPasskey,
  type PasskeyUnlockStorage,
} from './web-passkey-unlock';

export interface WebPasskeyUnlockDeps {
  storage: PasskeyUnlockStorage;
  getRpId?: () => string;
}

export interface WebKeyStoreDeps {
  /** Optional hook to discard the KEK on tab close/reload (Requirement 3.6). */
  lifecycle?: LifecycleAdapter;
  idleOptions?: IdleAutoLockOptions;
  /**
   * Shared idle controller from the home entry wiring. When set, the home
   * controller owns idle expiry (lock clears PHI + KEK together).
   */
  sharedIdle?: IdleAutoLock;
  /** Optional passkey-backed fast unlock for returning browser sessions. */
  passkeyUnlock?: WebPasskeyUnlockDeps;
}

export class WebSessionKeyStore implements SessionKeyStore {
  /** Volatile, RAM-only KEK; never persisted in plaintext (Requirement 3.5). */
  private kek: CryptoKeyRef | null = null;
  private readonly idle: IdleAutoLock;
  private readonly ownsIdle: boolean;
  private readonly passkeyUnlock?: WebPasskeyUnlockDeps;

  constructor(deps: WebKeyStoreDeps = {}) {
    this.passkeyUnlock = deps.passkeyUnlock ?? resolveBrowserPasskeyUnlockDeps();
    if (deps.sharedIdle) {
      this.idle = deps.sharedIdle;
      this.ownsIdle = false;
    } else {
      this.idle = new IdleAutoLock(() => this.onIdleLock(), deps.idleOptions);
      this.ownsIdle = true;
    }
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
   * Release the KEK from RAM, or from passkey-wrapped local storage when the
   * tab was reloaded. Falls back to passphrase re-derivation otherwise.
   */
  async unlock(): Promise<UnlockResult> {
    if (this.kek !== null) {
      this.idle.start();
      return { ok: true, kek: this.kek };
    }

    if (this.passkeyUnlock && hasStoredPasskeyUnlock(this.passkeyUnlock.storage)) {
      try {
        const kek = await unlockKekWithPasskey(this.passkeyUnlock);
        this.kek = kek;
        this.idle.start();
        return { ok: true, kek };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'PASSKEY_CANCELLED' || message === 'PASSKEY_PRF_UNAVAILABLE') {
          return { ok: false, reason: 'BIOMETRIC_FAILED' };
        }
        return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
      }
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

  notifyActivity(): void {
    this.idle.notifyActivity();
  }

  suspendIdle(): void {
    this.idle.suspend();
  }

  resumeIdle(): void {
    this.idle.resume();
  }

  getKek(): CryptoKeyRef | null {
    return this.kek;
  }

  isPasskeyUnlockAvailable(): boolean {
    return isPasskeyUnlockSupported() && this.passkeyUnlock !== undefined;
  }

  hasPasskeyUnlock(): boolean {
    return this.passkeyUnlock ? hasStoredPasskeyUnlock(this.passkeyUnlock.storage) : false;
  }

  async enablePasskeyUnlock(
    options?: { replace?: boolean },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.passkeyUnlock) {
      return { ok: false, message: 'Passkey unlock is not configured.' };
    }
    if (!this.isPasskeyUnlockAvailable()) {
      return { ok: false, message: 'Passkeys are not supported in this browser.' };
    }
    if (this.kek === null) {
      return { ok: false, message: 'Unlock with your passphrase first.' };
    }

    try {
      if (options?.replace) {
        clearPasskeyUnlock(this.passkeyUnlock.storage);
        await registerPasskeyUnlock(this.kek, this.passkeyUnlock);
      } else if (this.hasPasskeyUnlock()) {
        await refreshPasskeyUnlockWrap(this.kek, this.passkeyUnlock);
      } else {
        await registerPasskeyUnlock(this.kek, this.passkeyUnlock);
      }
      return { ok: true };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'Passkey setup failed.';
      return { ok: false, message: formatPasskeyUnlockError(code) };
    }
  }

  removePasskeyUnlock(): void {
    if (this.passkeyUnlock) {
      clearPasskeyUnlock(this.passkeyUnlock.storage);
    }
  }

  private onIdleLock(): void {
    if (!this.ownsIdle) {
      return;
    }
    this.kek = null;
  }
}
