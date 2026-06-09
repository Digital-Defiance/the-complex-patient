/**
 * @complex-patient/web — Root layout (Expo Router / React Native Web)
 *
 * The single composition point for the web app. Calls `createWebApp` once per
 * launch with the web platform adapters:
 * - `localStorage`-backed ineligibility flag storage (Requirement 14.3)
 * - Web lifecycle adapter (beforeunload/pagehide → discard KEK, Requirement 13.4)
 * - HTTPS Sync_Backend base URL (Requirement 4.2)
 *
 * Wraps the tree in `<AppHostProvider>` so every screen reads from the shared
 * controller state via `useAppHost()`. Controllers are constructed exactly once
 * per launch (Requirement 3.1); `enterHome()` is guarded so the Home_Controller
 * is never built before `onboarding = eligible` (Requirement 3.7).
 *
 * The secure-context check is deferred to `createHome()` (the age screen can
 * render outside a secure context); if `createHome()` throws
 * `SecureContextRequiredError`, the AppHost routes to the blocking
 * secure-context-required screen (Requirement 4.4).
 *
 * Requirements: 3.1, 3.7, 4.1, 4.2, 13.4
 */

import React from 'react';
import { Slot } from 'expo-router';
import { AppHostProvider, type AppHostFactory } from '@complex-patient/ui';
import { createWebApp } from '../src/entry';
import { webFlagStorage } from '../src/adapters';
import { createWebLifecycleAdapter } from '../src/lifecycle-adapter';

// ---------------------------------------------------------------------------
// Web host factory — constructs the composition root exactly once
// ---------------------------------------------------------------------------

/**
 * The HTTPS Sync_Backend base URL. In production this is loaded from
 * environment config. For the shell composition this is the well-known origin
 * the platform backend is deployed to.
 */
const SYNC_BACKEND_BASE_URL = 'https://api.thecomplexpatient.com';

const webFactory: AppHostFactory = {
  createApp() {
    return createWebApp({
      baseUrl: SYNC_BACKEND_BASE_URL,
      ineligibilityStorage: webFlagStorage,
      lifecycle: createWebLifecycleAdapter(),
    });
  },
};

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout(): React.ReactElement {
  return (
    <AppHostProvider factory={webFactory}>
      <Slot />
    </AppHostProvider>
  );
}
