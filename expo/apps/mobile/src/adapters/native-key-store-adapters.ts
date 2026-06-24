/**
 * @complex-patient/mobile — Native key-store adapters
 *
 * Concrete implementations of the FIXED `@complex-patient/key-store` adapter
 * interfaces, backed by the native Expo modules declared in this app
 * (`expo-secure-store`, `expo-local-authentication`).
 *
 * This module is the ONLY place these native modules are imported, so the rest
 * of the app shell stays platform-agnostic and testable under vitest
 * (design.md → Components → Platform Adapters). The adapters are injected into
 * `createMobileApp` / `createMobileHome` as the {@link SecureStoreAdapter} and
 * {@link BiometricAdapter} (Requirements 3.3, 3.4).
 */

import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { suspendBackgroundLock } from '@complex-patient/ui';
import type {
  BiometricAdapter,
  SecureStoreAdapter,
} from '@complex-patient/key-store';

/**
 * Secure Enclave key used to persist the serialized KEK. Keys may contain
 * alphanumeric characters, `.`, `-`, and `_` per the expo-secure-store contract.
 */
const KEK_KEY = 'complex-patient.kek';

/**
 * `expo-secure-store`-backed {@link SecureStoreAdapter} (Requirement 3.3).
 *
 * The KEK is stored inside the device Secure Enclave with
 * `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` — accessible only while
 * the device is unlocked and never migrated to another device via backup.
 *
 * Biometric gating is handled by {@link NativeSessionKeyStore} via
 * `expo-local-authentication`, not `requireAuthentication` on SecureStore writes.
 * Requiring authentication on `setItemAsync` breaks first-time passphrase unlock
 * (no Face ID permission / no enrolled biometrics yet) and double-prompts on read.
 */
export function createExpoSecureStoreAdapter(): SecureStoreAdapter {
  const storageOptions: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };

  return {
    async setKek(serialized: string): Promise<void> {
      await SecureStore.setItemAsync(KEK_KEY, serialized, storageOptions);
    },
    getKek(): Promise<string | null> {
      return SecureStore.getItemAsync(KEK_KEY, storageOptions);
    },
    deleteKek(): Promise<void> {
      return SecureStore.deleteItemAsync(KEK_KEY, storageOptions);
    },
  };
}

/**
 * `expo-local-authentication`-backed {@link BiometricAdapter} (Requirement 3.4).
 *
 * Reports availability only when biometric hardware is present AND enrolled,
 * and prompts the user for a biometric challenge, resolving `true` on success
 * and `false` on any failure.
 */
export function createExpoBiometricAdapter(): BiometricAdapter {
  return {
    async isAvailable(): Promise<boolean> {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      return hasHardware && isEnrolled;
    },
    async authenticate(): Promise<boolean> {
      const endBackgroundLockSuspension = suspendBackgroundLock();
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock your vault',
          disableDeviceFallback: false,
        });
        return result.success;
      } finally {
        endBackgroundLockSuspension();
      }
    },
  };
}
