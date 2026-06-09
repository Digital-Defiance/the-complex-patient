/**
 * @complex-patient/web — Root layout (Expo Router / React Native Web)
 *
 * Same architecture as the mobile layout: composes the controllers once,
 * wraps in AppHostProvider, and uses a RouteWatcher to drive navigation
 * based on controller state.
 */

import React, { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { AppHostProvider, useAppHost, type AppHostFactory } from '@complex-patient/ui';
import { createWebApp } from '../src/entry';
import { createWebLifecycleAdapter } from '../src/lifecycle-adapter';

// ---------------------------------------------------------------------------
// Web host factory
// ---------------------------------------------------------------------------

const SYNC_BACKEND_BASE_URL = 'https://thecomplexpatient.com';

const inMemoryFlagStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
})();

const webFactory: AppHostFactory = {
  createApp() {
    return createWebApp({
      baseUrl: SYNC_BACKEND_BASE_URL,
      ineligibilityStorage: inMemoryFlagStorage,
      lifecycle: createWebLifecycleAdapter(),
    });
  },
};

// ---------------------------------------------------------------------------
// RouteWatcher
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
    <AppHostProvider factory={webFactory}>
      <RouteWatcher />
      <Slot />
    </AppHostProvider>
  );
}
