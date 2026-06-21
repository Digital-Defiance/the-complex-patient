/**
 * Local weather cache persistence (derived data, not synced).
 *
 * Web: localStorage · Native: expo-file-system/legacy under documentDirectory
 */

import { Platform } from 'react-native';
import type { WeatherCacheStore } from '@complex-patient/weather';
import { createLocalStorageFlagStorage } from './device-flag-storage';

export function createWeatherCacheStore(): WeatherCacheStore {
  if (Platform.OS === 'web') {
    return createLocalStorageFlagStorage();
  }

  let fileBackend: WeatherCacheStore | null = null;

  return {
    async getItem(key) {
      const backend = await resolveFileBackend();
      return backend.getItem(key);
    },
    async setItem(key, value) {
      const backend = await resolveFileBackend();
      await backend.setItem(key, value);
    },
  };

  async function resolveFileBackend(): Promise<WeatherCacheStore> {
    if (fileBackend) {
      return fileBackend;
    }

    const FileSystem = await import('expo-file-system/legacy');
    const documentDirectory = FileSystem.documentDirectory;
    if (!documentDirectory) {
      throw new Error('expo-file-system documentDirectory is unavailable');
    }

    const cacheDir = `${documentDirectory}complex-patient-weather-cache/`;

    async function ensureDir(): Promise<void> {
      const info = await FileSystem.getInfoAsync(cacheDir);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
      }
    }

    function cacheFilePath(key: string): string {
      return `${cacheDir}${encodeURIComponent(key)}.json`;
    }

    await ensureDir();

    fileBackend = {
      async getItem(key) {
        try {
          const info = await FileSystem.getInfoAsync(cacheFilePath(key));
          if (!info.exists) {
            return null;
          }
          return await FileSystem.readAsStringAsync(cacheFilePath(key));
        } catch {
          return null;
        }
      },
      async setItem(key, value) {
        await ensureDir();
        await FileSystem.writeAsStringAsync(cacheFilePath(key), value);
      },
    };

    return fileBackend;
  }
}
