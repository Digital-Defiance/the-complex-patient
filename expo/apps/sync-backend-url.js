/**
 * Resolve the WordPress sync backend origin for the current build/runtime.
 *
 * Priority:
 * 1. EXPO_PUBLIC_SYNC_BACKEND_URL (explicit override)
 * 2. __DEV__ + Expo dev host (physical device / LAN: 172.16.0.14:8081 → http://172.16.0.14:8881)
 * 3. __DEV__ → WordPress Studio (localhost:8881; Android emulator uses 10.0.2.2:8881)
 * 4. Web opened on localhost / LAN → WordPress Studio on the same host (even in release builds)
 * 5. Production default
 *
 * Note: Metro serves JS on :8081; WordPress Studio serves the sync API on :8881.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
export const PRODUCTION_SYNC_BACKEND_URL = 'https://thecomplexpatient.com';
export const DEFAULT_LOCAL_SYNC_BACKEND_URL = 'http://localhost:8881';
export const DEFAULT_LOCAL_SYNC_BACKEND_PORT = 8881;
/** Android emulator loopback to the host machine's localhost. */
export const ANDROID_EMULATOR_SYNC_BACKEND_URL = `http://10.0.2.2:${DEFAULT_LOCAL_SYNC_BACKEND_PORT}`;
/** Map Expo dev server host (e.g. `172.16.0.14:8081`) to the local sync backend origin. */
export function syncBackendUrlFromExpoHostUri(hostUri, syncPort = DEFAULT_LOCAL_SYNC_BACKEND_PORT) {
    if (!hostUri?.trim()) {
        return null;
    }
    const host = hostUri.trim().split(':')[0];
    if (!host || host === 'localhost' || host === '127.0.0.1') {
        return null;
    }
    return `http://${host}:${syncPort}`;
}
function getExpoDevHostUri() {
    return (Constants.expoConfig?.hostUri ??
        Constants.expoGoConfig?.debuggerHost ??
        Constants.manifest?.debuggerHost);
}
/** RFC 1918 private IPv4 ranges used for on-LAN local WordPress during development. */
function isPrivateLanHost(hostname) {
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }
    const [first, second] = parts;
    if (first === 10)
        return true;
    if (first === 172 && second >= 16 && second <= 31)
        return true;
    if (first === 192 && second === 168)
        return true;
    return false;
}
/**
 * When the web bundle is served from localhost or a LAN IP, assume WordPress
 * Studio on the same host (port 8881). This prevents a release-mode web build
 * opened at http://localhost:8081 from syncing to production by mistake.
 */
export function syncBackendUrlFromBrowserLocation(hostname) {
    const host = hostname?.trim();
    if (!host) {
        return null;
    }
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return DEFAULT_LOCAL_SYNC_BACKEND_URL;
    }
    if (isPrivateLanHost(host)) {
        return `http://${host}:${DEFAULT_LOCAL_SYNC_BACKEND_PORT}`;
    }
    return null;
}
function resolveWebBrowserBackend() {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
        return null;
    }
    return syncBackendUrlFromBrowserLocation(window.location.hostname);
}
export function resolveSyncBackendBaseUrl() {
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
    const fromBrowser = resolveWebBrowserBackend();
    if (fromBrowser) {
        return fromBrowser;
    }
    return PRODUCTION_SYNC_BACKEND_URL;
}
//# sourceMappingURL=sync-backend-url.js.map