/**
 * @complex-patient/key-store — Type definitions
 *
 * The Session Key Store guards the in-memory KEK per platform (Requirement 3).
 * Plaintext key material lives strictly above the zero-knowledge boundary; this
 * module never serializes the KEK to anything that crosses the network.
 *
 * Platform-specific backends (Secure Enclave on native, volatile RAM on web)
 * and the system clock/timer are injected behind small adapter interfaces so
 * the locking behavior is fully testable without native modules.
 */

import type { CryptoKeyRef } from '@complex-patient/crypto-engine';

// ---------------------------------------------------------------------------
// Shared interface (design.md → Session Key Store, Requirement 3)
// ---------------------------------------------------------------------------

/**
 * The shared Session Key Store interface implemented per platform.
 *
 * - `store` records the KEK as the active session key (and persists it to the
 *   Secure Enclave on native; volatile RAM only on web — Requirements 3.1, 3.5).
 * - `unlock` releases the KEK after the platform unlock challenge (biometric or
 *   passphrase fallback — Requirements 3.2, 3.3, 3.4).
 * - `lock` discards the in-memory KEK (Requirements 3.6, 3.7).
 * - `isUnlocked` reports whether a KEK is currently held in memory.
 */
export interface SessionKeyStore {
  store(kek: CryptoKeyRef): Promise<void>;
  unlock(): Promise<UnlockResult>;
  lock(): Promise<void>;
  isUnlocked(): boolean;
}

/**
 * Result of an {@link SessionKeyStore.unlock} attempt.
 *
 * On success the caller receives the released KEK. On failure the `reason`
 * tells the caller how to proceed — most importantly whether to fall back to
 * Master_Passphrase re-entry (Requirements 3.3, 3.4, 3.8).
 */
export type UnlockResult =
  | { ok: true; kek: CryptoKeyRef }
  | { ok: false; reason: UnlockFailureReason };

/**
 * - `NO_KEY_STORED`: no KEK has ever been stored; caller must derive + `store`.
 * - `BIOMETRIC_FAILED`: a biometric attempt failed but retries remain.
 * - `BIOMETRIC_LOCKED_OUT`: biometrics disabled for this session after 5
 *   consecutive failures; caller must fall back to passphrase (Requirement 3.3).
 * - `PASSPHRASE_REQUIRED`: biometrics unavailable, or the vault is locked and a
 *   passphrase re-derivation is required (Requirements 3.4, 3.6, 3.7, 3.8).
 */
export type UnlockFailureReason =
  | 'NO_KEY_STORED'
  | 'BIOMETRIC_FAILED'
  | 'BIOMETRIC_LOCKED_OUT'
  | 'PASSPHRASE_REQUIRED';

// ---------------------------------------------------------------------------
// Injected platform adapters
// ---------------------------------------------------------------------------

/**
 * Reversible codec between a {@link CryptoKeyRef} and an opaque string for
 * persistence in the Secure Enclave. Injected so the key store never assumes a
 * particular inner key representation (raw bytes vs Web CryptoKey).
 */
export interface KekCodec {
  serialize(kek: CryptoKeyRef): string;
  deserialize(serialized: string): CryptoKeyRef;
}

/**
 * Secure key persistence — modeled on `expo-secure-store`. Stores the serialized
 * KEK inside the device Secure Enclave (Requirement 3.1). Biometric gating is
 * enforced by {@link NativeSessionKeyStore} via {@link BiometricAdapter}, not
 * necessarily by SecureStore `requireAuthentication`.
 */
export interface SecureStoreAdapter {
  setKek(serialized: string): Promise<void>;
  /** Returns the serialized KEK, or `null` if nothing is stored. */
  getKek(): Promise<string | null>;
  deleteKek(): Promise<void>;
}

/**
 * Biometric authentication backend — modeled on `expo-local-authentication`.
 * Used to gate release of the KEK from the Secure Enclave (Requirement 3.2).
 */
export interface BiometricAdapter {
  /** Whether FaceID/Fingerprint hardware is enrolled and available (3.4). */
  isAvailable(): Promise<boolean>;
  /** Prompt the user; resolves `true` on success, `false` on failure. */
  authenticate(): Promise<boolean>;
}

/**
 * Web tab lifecycle hook used to discard the KEK on tab close/reload
 * (Requirement 3.6). Injected so tests can drive the event directly.
 */
export interface LifecycleAdapter {
  /** Register a handler invoked when the tab is closing or reloading. */
  onTabClose(handler: () => void): void;
}

// ---------------------------------------------------------------------------
// Injected timer abstraction (for the shared idle auto-lock)
// ---------------------------------------------------------------------------

/** Opaque handle returned by {@link TimerScheduler.setTimeout}. */
export type TimerHandle = unknown;

/**
 * Minimal timer abstraction so the 300s idle auto-lock (Requirement 3.7) can be
 * driven by fake timers in tests instead of real wall-clock time.
 */
export interface TimerScheduler {
  setTimeout(handler: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** Default 300-second idle timeout before auto-lock (Requirement 3.7). */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
