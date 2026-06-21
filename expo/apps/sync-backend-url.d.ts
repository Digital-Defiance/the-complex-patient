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
export declare const PRODUCTION_SYNC_BACKEND_URL = "https://thecomplexpatient.com";
export declare const DEFAULT_LOCAL_SYNC_BACKEND_URL = "http://localhost:8881";
export declare const DEFAULT_LOCAL_SYNC_BACKEND_PORT = 8881;
/** Android emulator loopback to the host machine's localhost. */
export declare const ANDROID_EMULATOR_SYNC_BACKEND_URL = "http://10.0.2.2:8881";
/** Map Expo dev server host (e.g. `172.16.0.14:8081`) to the local sync backend origin. */
export declare function syncBackendUrlFromExpoHostUri(hostUri: string | null | undefined, syncPort?: number): string | null;
/**
 * When the web bundle is served from localhost or a LAN IP, assume WordPress
 * Studio on the same host (port 8881). This prevents a release-mode web build
 * opened at http://localhost:8081 from syncing to production by mistake.
 */
export declare function syncBackendUrlFromBrowserLocation(hostname: string | null | undefined): string | null;
export declare function resolveSyncBackendBaseUrl(): string;
//# sourceMappingURL=sync-backend-url.d.ts.map