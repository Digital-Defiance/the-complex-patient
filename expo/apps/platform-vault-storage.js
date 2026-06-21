/**
 * Platform Local_Vault persistence.
 *
 * - Native (iOS/Android): expo-file-system/legacy document directory
 * - Web / mobile-on-web: localStorage
 */
import { Platform } from 'react-native';
import { KeyValueStorageBackend } from '@complex-patient/local-vault';
import { createLocalStorageFlagStorage } from './device-flag-storage';
export function createLocalStorageVaultBackend() {
    const storage = createLocalStorageFlagStorage();
    return new KeyValueStorageBackend({
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
            storage.setItem(key, value);
        },
    });
}
async function createFileSystemVaultBackend() {
    const FileSystem = await import('expo-file-system/legacy');
    const documentDirectory = FileSystem.documentDirectory;
    if (!documentDirectory) {
        throw new Error('expo-file-system documentDirectory is unavailable');
    }
    const vaultDir = `${documentDirectory}complex-patient-vault/`;
    async function ensureVaultDir() {
        const info = await FileSystem.getInfoAsync(vaultDir);
        if (!info.exists) {
            await FileSystem.makeDirectoryAsync(vaultDir, { intermediates: true });
        }
    }
    function vaultFilePath(key) {
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
            }
            catch {
                return null;
            }
        },
        async setItem(key, value) {
            await ensureVaultDir();
            await FileSystem.writeAsStringAsync(vaultFilePath(key), value);
        },
    });
}
/**
 * Resolve durable encrypted vault storage for the current runtime.
 */
export async function createPlatformVaultStorageBackend() {
    if (Platform.OS === 'web') {
        return createLocalStorageVaultBackend();
    }
    try {
        return await createFileSystemVaultBackend();
    }
    catch (cause) {
        if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
            console.warn('[VaultStorage] native file storage unavailable; falling back to localStorage:', cause instanceof Error ? cause.message : String(cause));
            return createLocalStorageVaultBackend();
        }
        throw cause;
    }
}
//# sourceMappingURL=platform-vault-storage.js.map