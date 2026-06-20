/**
 * @complex-patient/mobile
 *
 * iOS + Android entry point.
 * Uses Expo Router, expo-secure-store, and expo-notifications.
 *
 * The authenticated home interface is composed from the shared
 * `@complex-patient/ui` codebase with identical feature parity to web
 * (Requirements 22.1, 22.2), connected to the native Session Key Store and the
 * blind Sync_Backend authenticated via WordPress JWT / Application Passwords
 * (Requirement 4.1).
 */

export type { MobileEntryOptions } from './entry';
export { createMobileHome } from './entry';
export { createKekCodec, nativeFlagStorage, nativeKdfStorage } from './adapters';

/**
 * Native key-store adapters (Requirements 3.3, 3.4): concrete
 * expo-secure-store / expo-local-authentication implementations of the fixed
 * `@complex-patient/key-store` adapter interfaces, injected into the app shell.
 */
export {
  createExpoSecureStoreAdapter,
  createExpoBiometricAdapter,
} from './adapters/native-key-store-adapters';
