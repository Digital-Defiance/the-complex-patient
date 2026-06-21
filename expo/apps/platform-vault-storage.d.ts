/**
 * Platform Local_Vault persistence.
 *
 * - Native (iOS/Android): expo-file-system/legacy document directory
 * - Web / mobile-on-web: localStorage
 */
import { KeyValueStorageBackend } from '@complex-patient/local-vault';
export declare function createLocalStorageVaultBackend(): KeyValueStorageBackend;
/**
 * Resolve durable encrypted vault storage for the current runtime.
 */
export declare function createPlatformVaultStorageBackend(): Promise<KeyValueStorageBackend>;
//# sourceMappingURL=platform-vault-storage.d.ts.map