/**
 * @complex-patient/key-store — Native (iOS/Android) Session Key Store
 *
 * Stores the KEK in the device Secure Enclave via an injected
 * {@link SecureStoreAdapter} (expo-secure-store at runtime) and gates release
 * behind a biometric challenge (expo-local-authentication at runtime)
 * (Requirements 3.1, 3.2).
 *
 * Locking policy:
 * - 5 consecutive biometric failures disable biometrics for the session, retain
 *   the KEK in the enclave, and force passphrase fallback (Requirement 3.3).
 * - When biometrics are unavailable, unlock requires passphrase re-entry
 *   (Requirement 3.4).
 * - The shared 300s idle timer discards the in-memory KEK and locks the vault;
 *   while locked, the KEK is not released without a fresh unlock (Requirements
 *   3.7, 3.8).
 */

import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import { IdleAutoLock, type IdleAutoLockOptions } from './idle-lock';
import type {
  BiometricAdapter,
  KekCodec,
  SecureStoreAdapter,
  SessionKeyStore,
  UnlockResult,
} from './types';

/** Number of consecutive biometric failures that triggers lockout (3.3). */
export const BIOMETRIC_MAX_ATTEMPTS = 5;

export interface NativeKeyStoreDeps {
  secureStore: SecureStoreAdapter;
  biometrics: BiometricAdapter;
  codec: KekCodec;
  idleOptions?: IdleAutoLockOptions;
  /** Shared idle controller from the home entry wiring. */
  sharedIdle?: IdleAutoLock;
}

export class NativeSessionKeyStore implements SessionKeyStore {
  private readonly secureStore: SecureStoreAdapter;
  private readonly biometrics: BiometricAdapter;
  private readonly codec: KekCodec;
  private readonly idle: IdleAutoLock;
  private readonly ownsIdle: boolean;

  /** In-memory KEK; null while locked (Requirements 3.7, 3.8). */
  private kek: CryptoKeyRef | null = null;
  /** Consecutive biometric failure counter for the current session (3.3). */
  private biometricFailures = 0;
  /** Set once biometrics are disabled for the session after lockout (3.3). */
  private biometricsDisabledForSession = false;

  constructor(deps: NativeKeyStoreDeps) {
    this.secureStore = deps.secureStore;
    this.biometrics = deps.biometrics;
    this.codec = deps.codec;
    if (deps.sharedIdle) {
      this.idle = deps.sharedIdle;
      this.ownsIdle = false;
    } else {
      this.idle = new IdleAutoLock(() => this.onIdleLock(), deps.idleOptions);
      this.ownsIdle = true;
    }
  }

  /**
   * Persist the freshly-derived KEK to the Secure Enclave and hold it in memory
   * as the active session key. Starts the idle countdown (Requirements 3.1,
   * 3.7).
   */
  async store(kek: CryptoKeyRef): Promise<void> {
    await this.secureStore.setKek(this.codec.serialize(kek));
    this.kek = kek;
    this.biometricFailures = 0;
    this.biometricsDisabledForSession = false;
    this.idle.start();
  }

  /**
   * Release the KEK after the platform unlock challenge.
   *
   * If biometrics are available and not disabled for the session, prompt for a
   * biometric (Requirement 3.2). After 5 consecutive failures, disable
   * biometrics for the session and require passphrase fallback (Requirement
   * 3.3). When biometrics are unavailable or disabled, signal that passphrase
   * re-entry is required (Requirements 3.4, 3.8).
   */
  async unlock(): Promise<UnlockResult> {
    const serialized = await this.secureStore.getKek();
    if (serialized === null) {
      return { ok: false, reason: 'NO_KEY_STORED' };
    }

    // Biometrics unavailable on device → passphrase fallback (3.4).
    const available = await this.biometrics.isAvailable();
    if (!available || this.biometricsDisabledForSession) {
      return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
    }

    const success = await this.biometrics.authenticate();
    if (success) {
      this.biometricFailures = 0;
      const kek = this.codec.deserialize(serialized);
      this.kek = kek;
      this.idle.start();
      return { ok: true, kek };
    }

    // Failed attempt — count toward the lockout threshold (3.3).
    this.biometricFailures += 1;
    if (this.biometricFailures >= BIOMETRIC_MAX_ATTEMPTS) {
      this.biometricsDisabledForSession = true;
      return { ok: false, reason: 'BIOMETRIC_LOCKED_OUT' };
    }
    return { ok: false, reason: 'BIOMETRIC_FAILED' };
  }

  /**
   * Discard the in-memory KEK and stop the idle timer. The KEK remains in the
   * Secure Enclave (Requirement 3.3 retains it across lock); a subsequent
   * unlock must pass the platform challenge again (Requirement 3.8).
   */
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

  /** Pause idle auto-lock during long-running local operations. */
  suspendIdle(): void {
    this.idle.suspend();
  }

  /** Resume idle auto-lock after a suspended operation completes. */
  resumeIdle(): void {
    this.idle.resume();
  }

  /** Read the released KEK while unlocked; null once locked (3.8). */
  getKek(): CryptoKeyRef | null {
    return this.kek;
  }

  /** Idle expiry when this store owns its idle timer (standalone / tests). */
  private onIdleLock(): void {
    if (!this.ownsIdle) {
      return;
    }
    this.kek = null;
  }
}
