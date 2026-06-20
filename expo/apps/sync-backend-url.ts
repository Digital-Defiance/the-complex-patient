/**
 * Resolve the WordPress sync backend origin for the current build/runtime.
 *
 * Priority:
 * 1. EXPO_PUBLIC_SYNC_BACKEND_URL (explicit override)
 * 2. __DEV__ + Expo dev host (physical device / LAN: 172.16.0.14:8081 → http://172.16.0.14:8080)
 * 3. __DEV__ → local WordPress (localhost; Android emulator uses 10.0.2.2)
 * 4. Production default
 *
 * Note: Metro serves JS on :8081; local WordPress sync API is expected on :8080.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const PRODUCTION_SYNC_BACKEND_URL = 'https://thecomplexpatient.com';
export const DEFAULT_LOCAL_SYNC_BACKEND_URL = 'http://localhost:8881';
export const ANDROID_EMULATOR_SYNC_BACKEND_URL = 'http://10.0.2.2:8080';
export const DEFAULT_LOCAL_SYNC_BACKEND_PORT = 8080;

/** Map Expo dev server host (e.g. `172.16.0.14:8081`) to the local sync backend origin. */
export function syncBackendUrlFromExpoHostUri(
  hostUri: string | null | undefined,
  syncPort = DEFAULT_LOCAL_SYNC_BACKEND_PORT,
): string | null {
  if (!hostUri?.trim()) {
    return null;
  }

  const host = hostUri.trim().split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return null;
  }

  return `http://${host}:${syncPort}`;
}

function getExpoDevHostUri(): string | null | undefined {
  return (
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    (Constants.manifest as { debuggerHost?: string } | null)?.debuggerHost
  );
}

export function resolveSyncBackendBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_SYNC_BACKEND_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const fromExpoHost = syncBackendUrlFromExpoHostUri(getExpoDevHostUri());
    if (fromExpoHost) {
      return fromExpoHost;
    }

    if (Platform.OS === 'android') {
      return ANDROID_EMULATOR_SYNC_BACKEND_URL;
    }
    return DEFAULT_LOCAL_SYNC_BACKEND_URL;
  }

  return PRODUCTION_SYNC_BACKEND_URL;
}
