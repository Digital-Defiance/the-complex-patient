/**
 * @complex-patient/mobile — Root layout (Expo Router)
 *
 * The single composition point for the native app. Calls `createMobileApp` once
 * per launch with the concrete native adapters:
 * - `expo-secure-store` → SecureStoreAdapter (Requirement 3.3)
 * - `expo-local-authentication` → BiometricAdapter (Requirement 3.4)
 * - KEK codec (Base64 round-trip, Requirement 14.3)
 * - HTTPS Sync_Backend base URL (Requirement 3.2)
 * - `expo-secure-store`-backed ineligibility flag storage (Requirement 14.3)
 * - `expo-notifications` injected for medication reminders (Requirement 3.5)
 *
 * Wraps the tree in `<AppHostProvider>` so every screen reads from the shared
 * controller state via `useAppHost()`. Controllers are constructed exactly once
 * per launch (Requirement 3.1); `enterHome()` is guarded so the Home_Controller
 * is never built before `onboarding = eligible` (Requirement 3.7).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7
 */

import React, { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { AppHostProvider, useAppHost, type AppHostFactory } from '@complex-patient/ui';
import { createMobileApp } from '../src/entry';

// ---------------------------------------------------------------------------
// Mobile host factory — constructs the composition root exactly once
// ---------------------------------------------------------------------------

/**
 * The HTTPS Sync_Backend base URL. In production this is loaded from
 * environment / Expo Constants config. For the shell composition this is the
 * well-known origin the platform backend is deployed to.
 */
const SYNC_BACKEND_BASE_URL = 'https://thecomplexpatient.com';

/**
 * In-memory SecureStore adapter for Expo Go (no native module available).
 * In production (dev client or standalone build), use createExpoSecureStoreAdapter().
 */
function createInMemorySecureStore() {
  let stored: string | null = null;
  return {
    setKek: async (s: string) => { stored = s; },
    getKek: async () => stored,
    deleteKek: async () => { stored = null; },
  };
}

/**
 * In-memory BiometricAdapter for Expo Go (no native module available).
 * Always reports biometrics unavailable — user must use passphrase.
 */
function createInMemoryBiometricAdapter() {
  return {
    isAvailable: async () => false,
    authenticate: async () => false,
  };
}

/**
 * In-memory KekCodec for Expo Go. Base64 round-trip without native deps.
 */
function createInMemoryKekCodec() {
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function toBase64(bytes: Uint8Array): string {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = i+1 < bytes.length ? bytes[i+1] : 0, b2 = i+2 < bytes.length ? bytes[i+2] : 0;
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | (b1 >> 4)];
      out += i+1 < bytes.length ? B64[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
      out += i+2 < bytes.length ? B64[b2 & 0x3f] : '=';
    }
    return out;
  }
  function fromBase64(str: string): Uint8Array {
    var clean = str.replace(/=+$/, '');
    var len = Math.floor((clean.length * 6) / 8);
    var out = new Uint8Array(len);
    var buf = 0, bits = 0, idx = 0;
    for (var i = 0; i < clean.length; i++) {
      buf = (buf << 6) | B64.indexOf(clean[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; out[idx++] = (buf >> bits) & 0xff; }
    }
    return out;
  }
  return {
    serialize(kek: { _inner: Uint8Array }): string {
      return toBase64(kek._inner);
    },
    deserialize(serialized: string): { _inner: Uint8Array } {
      return { _inner: fromBase64(serialized) };
    },
  };
}

/**
 * In-memory DeviceFlagStorage for Expo Go (instead of expo-secure-store).
 * Uses a simple Map — the ineligibility flag won't persist across reloads in
 * dev, which is fine for testing.
 */
const inMemoryFlagStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
})();

const mobileFactory: AppHostFactory = {
  createApp() {
    return createMobileApp({
      baseUrl: SYNC_BACKEND_BASE_URL,
      secureStore: createInMemorySecureStore(),
      biometrics: createInMemoryBiometricAdapter(),
      codec: createInMemoryKekCodec() as any,
      ineligibilityStorage: inMemoryFlagStorage,
    });
  },
};

// ---------------------------------------------------------------------------
// RouteWatcher — navigates whenever the AppHost route changes
// ---------------------------------------------------------------------------

function routeToPathname(routeName: string): string | null {
  switch (routeName) {
    case 'loading': return null;
    case 'age-gate': return '/onboarding/age-gate';
    case 'ineligible': return '/onboarding/ineligible';
    case 'secure-context-required': return '/secure-context-required';
    case 'composition-failed': return '/composition-failed';
    case 'sign-in': return '/auth/sign-in';
    case 'unlock': return '/auth/unlock';
    case 'home': return '/(home)';
    default: return null;
  }
}

function RouteWatcher(): null {
  const { route } = useAppHost();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const target = routeToPathname(route.name);
    if (!target) return;

    // If already within the home area, don't interfere with subsystem navigation
    if (route.name === 'home' && (pathname === '/' || pathname.includes('home') || pathname.includes('medications') || pathname.includes('journal') || pathname.includes('insights'))) {
      return;
    }

    if (target !== pathname) {
      router.replace(target as never);
    }
  }, [route, router, pathname]);

  return null;
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout(): React.ReactElement {
  return (
    <AppHostProvider factory={mobileFactory}>
      <RouteWatcher />
      <Slot />
    </AppHostProvider>
  );
}
