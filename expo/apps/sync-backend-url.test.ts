/**
 * Sync backend URL resolution tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockConstants = {
  expoConfig: null as { hostUri?: string } | null,
  expoGoConfig: null as { debuggerHost?: string } | null,
  manifest: null as { debuggerHost?: string } | null,
};

const mockPlatform = { OS: 'ios' as 'ios' | 'android' };

vi.mock('expo-constants', () => ({
  default: mockConstants,
}));

vi.mock('react-native', () => ({
  Platform: mockPlatform,
}));

describe('syncBackendUrlFromExpoHostUri', () => {
  it('maps Expo LAN host to local sync backend on port 8080', async () => {
    const { syncBackendUrlFromExpoHostUri } = await import('./sync-backend-url');
    expect(syncBackendUrlFromExpoHostUri('172.16.0.14:8081')).toBe('http://172.16.0.14:8080');
  });

  it('returns null for loopback Expo hosts', async () => {
    const { syncBackendUrlFromExpoHostUri } = await import('./sync-backend-url');
    expect(syncBackendUrlFromExpoHostUri('localhost:8081')).toBeNull();
    expect(syncBackendUrlFromExpoHostUri('127.0.0.1:8081')).toBeNull();
    expect(syncBackendUrlFromExpoHostUri(null)).toBeNull();
  });
});

describe('resolveSyncBackendBaseUrl', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    vi.resetModules();
    mockConstants.expoConfig = null;
    mockConstants.expoGoConfig = null;
    mockConstants.manifest = null;
    mockPlatform.OS = 'ios';
  });

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
    vi.unstubAllEnvs();
  });

  it('uses EXPO_PUBLIC_SYNC_BACKEND_URL when set', async () => {
    vi.stubEnv('EXPO_PUBLIC_SYNC_BACKEND_URL', 'http://my-local.test:9090/');
    const { resolveSyncBackendBaseUrl } = await import('./sync-backend-url');
    expect(resolveSyncBackendBaseUrl()).toBe('http://my-local.test:9090');
  });

  it('uses Expo LAN host in development when available', async () => {
    mockConstants.expoConfig = { hostUri: '172.16.0.14:8081' };
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    vi.stubEnv('EXPO_PUBLIC_SYNC_BACKEND_URL', '');
    const { resolveSyncBackendBaseUrl } = await import('./sync-backend-url');
    expect(resolveSyncBackendBaseUrl()).toBe('http://172.16.0.14:8080');
  });

  it('uses local WordPress in development without Expo LAN host', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    vi.stubEnv('EXPO_PUBLIC_SYNC_BACKEND_URL', '');
    const { resolveSyncBackendBaseUrl, DEFAULT_LOCAL_SYNC_BACKEND_URL } = await import('./sync-backend-url');
    expect(resolveSyncBackendBaseUrl()).toBe(DEFAULT_LOCAL_SYNC_BACKEND_URL);
  });

  it('uses Android emulator host when no LAN host is available', async () => {
    mockPlatform.OS = 'android';
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    vi.stubEnv('EXPO_PUBLIC_SYNC_BACKEND_URL', '');
    const { resolveSyncBackendBaseUrl, ANDROID_EMULATOR_SYNC_BACKEND_URL } = await import('./sync-backend-url');
    expect(resolveSyncBackendBaseUrl()).toBe(ANDROID_EMULATOR_SYNC_BACKEND_URL);
  });

  it('uses production URL in release builds', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    vi.stubEnv('EXPO_PUBLIC_SYNC_BACKEND_URL', '');
    const { resolveSyncBackendBaseUrl, PRODUCTION_SYNC_BACKEND_URL } = await import('./sync-backend-url');
    expect(resolveSyncBackendBaseUrl()).toBe(PRODUCTION_SYNC_BACKEND_URL);
  });
});
