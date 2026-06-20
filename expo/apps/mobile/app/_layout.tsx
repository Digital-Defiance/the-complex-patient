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

import '../src/crypto-setup';

import React, { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { AppHostProvider, useAppHost, type AppHostFactory } from '@complex-patient/ui';
import { createMobileApp } from '../src/entry';
import { createKekCodec, nativeFlagStorage } from '../src/adapters';
import {
  createExpoBiometricAdapter,
  createExpoSecureStoreAdapter,
} from '../src/adapters/native-key-store-adapters';
import { resolveSyncBackendBaseUrl } from '../../sync-backend-url';
import { isWithinHomeArea } from '../../home-route-guard';

const SYNC_BACKEND_BASE_URL = resolveSyncBackendBaseUrl();

const mobileFactory: AppHostFactory = {
  createApp() {
    return createMobileApp({
      baseUrl: SYNC_BACKEND_BASE_URL,
      secureStore: createExpoSecureStoreAdapter(),
      biometrics: createExpoBiometricAdapter(),
      codec: createKekCodec(),
      ineligibilityStorage: nativeFlagStorage,
    });
  },
};

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

    if (route.name === 'home' && isWithinHomeArea(pathname)) {
      return;
    }

    if (target !== pathname) {
      router.replace(target as never);
    }
  }, [route, router, pathname]);

  return null;
}

export default function RootLayout(): React.ReactElement {
  return (
    <AppHostProvider factory={mobileFactory}>
      <RouteWatcher />
      <Slot />
    </AppHostProvider>
  );
}
