/**
 * Shared device flag storage for age-gate ineligibility (outside Local_Vault).
 *
 * Native uses expo-secure-store; web and mobile-on-web use localStorage because
 * SecureStore is unavailable in the browser.
 */

import { Platform } from 'react-native';
import type { DeviceFlagStorage } from '@complex-patient/ui';

/** Browser/localStorage backing store (sync getItem/setItem). */
export function createLocalStorageFlagStorage(): DeviceFlagStorage {
  return {
    getItem: (key) => {
      if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return null;
      }
      return window.localStorage.getItem(key);
    },
    setItem: (key, value) => {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        window.localStorage.setItem(key, value);
      }
    },
  };
}

/**
 * Resolve flag storage for the current runtime.
 *
 * @param secureStore - async secure storage (native only)
 */
export function createDeviceFlagStorage(secureStore: DeviceFlagStorage): DeviceFlagStorage {
  if (Platform.OS === 'web') {
    return createLocalStorageFlagStorage();
  }
  return secureStore;
}
