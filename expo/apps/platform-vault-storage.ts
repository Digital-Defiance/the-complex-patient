/**
 * Platform Local_Vault persistence.
 *
 * - Native (iOS/Android): expo-file-system/legacy document directory
 * - Web / mobile-on-web: localStorage
 */

import { Platform } from 'react-native';
import { KeyValueStorageBackend } from '@complex-patient/local-vault';
import { createLocalStorageFlagStorage } from './device-flag-storage';

export function createLocalStorageVaultBackend(): KeyValueStorageBackend {
  const storage = createLocalStorageFlagStorage();
  return new KeyValueStorageBackend({
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => {
      storage.setItem(key, value);
    },
    removeItem: (key) => {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        window.localStorage.removeItem(key);
      }
    },
  });
}

async function createFileSystemVaultBackend(): Promise<KeyValueStorageBackend> {
  const FileSystem = await import('expo-file-system/legacy');
  const documentDirectory = FileSystem.documentDirectory;

  if (!documentDirectory) {
    throw new Error('expo-file-system documentDirectory is unavailable');
  }

  const vaultDir = `${documentDirectory}complex-patient-vault/`;

  async function ensureVaultDir(): Promise<void> {
    const info = await FileSystem.getInfoAsync(vaultDir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(vaultDir, { intermediates: true });
    }
  }

  function vaultFilePath(key: string): string {
    return `${vaultDir}${encodeURIComponent(key)}.json`;
  }

  await ensureVaultDir();

  return new KeyValueStorageBackend({
    async getItem(key) {
      try {
        const info = await FileSystem.getInfoAsync(vaultFilePath(key));
        if (!info.exists) {
          return null;
        }
        return await FileSystem.readAsStringAsync(vaultFilePath(key));
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      await ensureVaultDir();
      await FileSystem.writeAsStringAsync(vaultFilePath(key), value);
    },
    async removeItem(key) {
      try {
        const path = vaultFilePath(key);
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
          await FileSystem.deleteAsync(path, { idempotent: true });
        }
      } catch {
        // Missing partition files are treated as already cleared.
      }
    },
  });
}

/**
 * Resolve durable encrypted vault storage for the current runtime.
 */
export async function createPlatformVaultStorageBackend(): Promise<KeyValueStorageBackend> {
  if (Platform.OS === 'web') {
    return createLocalStorageVaultBackend();
  }

  try {
    return await createFileSystemVaultBackend();
  } catch (cause) {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      console.warn(
        '[VaultStorage] native file storage unavailable; falling back to localStorage:',
        cause instanceof Error ? cause.message : String(cause),
      );
      return createLocalStorageVaultBackend();
    }
    throw cause;
  }
}
