/**
 * @complex-patient/key-store
 *
 * Session Key Store (Requirement 3): platform-specific KEK protection behind a
 * shared {@link SessionKeyStore} interface, plus the shared 300s idle-timeout
 * auto-lock used on every platform.
 *
 * - Native (iOS/Android): KEK in the Secure Enclave via expo-secure-store,
 *   biometric unlock, 5-failure lockout to passphrase fallback, passphrase
 *   fallback when biometrics are unavailable.
 * - Web: KEK in volatile RAM only, discarded on tab close/reload.
 * - Shared: 300s idle auto-lock discards the in-memory KEK and locks the vault;
 *   passphrase re-entry is required while locked.
 */

export type {
  SessionKeyStore,
  UnlockResult,
  UnlockFailureReason,
  KekCodec,
  SecureStoreAdapter,
  BiometricAdapter,
  LifecycleAdapter,
  TimerScheduler,
  TimerHandle,
} from './types';

export { DEFAULT_IDLE_TIMEOUT_MS } from './types';
export { IdleAutoLock, systemTimerScheduler } from './idle-lock';
export type { IdleAutoLockOptions } from './idle-lock';
export {
  NativeSessionKeyStore,
  BIOMETRIC_MAX_ATTEMPTS,
} from './native-key-store';
export type { NativeKeyStoreDeps } from './native-key-store';
export { WebSessionKeyStore } from './web-key-store';
export type { WebKeyStoreDeps } from './web-key-store';
