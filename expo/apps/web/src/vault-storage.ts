/** Re-export shared platform vault storage (web uses localStorage). */
export {
  createLocalStorageVaultBackend as createWebVaultStorageBackend,
  createPlatformVaultStorageBackend,
} from '../../platform-vault-storage';
