/**
 * Shared device flag storage for age-gate ineligibility (outside Local_Vault).
 *
 * Native uses expo-secure-store; web and mobile-on-web use localStorage because
 * SecureStore is unavailable in the browser.
 */
import type { DeviceFlagStorage } from '@complex-patient/ui';
/** Browser/localStorage backing store (sync getItem/setItem). */
export declare function createLocalStorageFlagStorage(): DeviceFlagStorage;
/**
 * Resolve flag storage for the current runtime.
 *
 * @param secureStore - async secure storage (native only)
 */
export declare function createDeviceFlagStorage(secureStore: DeviceFlagStorage): DeviceFlagStorage;
//# sourceMappingURL=device-flag-storage.d.ts.map