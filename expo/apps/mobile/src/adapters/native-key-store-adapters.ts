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
 * The KEK is stored inside the device Secure Enclave with:
 * - `requireAuthentication: true` — release of the entry is gated behind the
 *   device biometric / passcode challenge.
 * - `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` — the entry is only
 *   accessible while the device is unlocked and is never migrated to another
 *   device via backup.
 */
export function createExpoSecureStoreAdapter(): SecureStoreAdapter {
  const options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: 'Unlock your vault',
  };

  return {
    async setKek(serialized: string): Promise<void> {
      await SecureStore.setItemAsync(KEK_KEY, serialized, options);
    },
    getKek(): Promise<string | null> {
      return SecureStore.getItemAsync(KEK_KEY, options);
    },
    deleteKek(): Promise<void> {
      return SecureStore.deleteItemAsync(KEK_KEY, options);
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
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock your vault',
        disableDeviceFallback: false,
      });
      return result.success;
    },
  };
}
