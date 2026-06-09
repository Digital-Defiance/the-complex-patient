/**
 * @complex-patient/local-vault
 *
 * Encrypted persistence abstraction over expo-sqlite / encrypted MMKV.
 * Stores only ciphertext at rest. Source of truth for the UI.
 */

export type {
  VaultBlob,
  StorageBackend,
  StorageNamespace,
  LocalVaultErrorCode,
} from './types';

export { LocalVaultError } from './types';

export type { LocalVault } from './vault';
export { EncryptedLocalVault, createLocalVault } from './vault';

export type { MemoryStorageBackendOptions } from './memory-backend';
export { MemoryStorageBackend } from './memory-backend';
