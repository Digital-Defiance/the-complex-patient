/**
 * @complex-patient/ui — AppHost context and provider
 *
 * The AppHost is the shared, platform-agnostic React context that exposes the
 * composed controllers (onboarding + home) and the derived navigation route to
 * the entire component tree. Both the mobile (Expo Router) and web (React
 * Native Web) root layouts construct platform-specific adapters and then render
 * an `<AppHostProvider>` that:
 *
 * 1. Calls the composition root (`createMobileApp` / `createWebApp`) exactly
 *    ONCE per launch (Requirement 3.1).
 * 2. Starts the onboarding controller before any screen renders (Requirement 5.1).
 * 3. Exposes `route` (derived via `resolveRoute` on every controller notification)
 *    so screens and navigation stay provably consistent with controller state.
 * 4. Guards `enterHome()` so the Home_Controller is NEVER built before
 *    `onboarding = eligible` (Requirement 3.7).
 *
 * The context value is stable between re-renders (controllers are singletons);
 * only `route`, `home`, and `navState` change as the controllers transition.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 4.1, 5.1
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { AgeGateOnboardingController, HomeEntryController, OnboardingStatus } from '../app';
import type { AppRoute, NavState } from './navigation';
import { resolveRoute } from './navigation';

// ---------------------------------------------------------------------------
// AppHost interface
// ---------------------------------------------------------------------------

/** The value exposed to the tree by the AppHost context. */
export interface AppHost {
  /** The age-gate controller, started once on mount (Requirement 5.1). */
  onboarding: AgeGateOnboardingController;
  /** Resolved after eligibility; null until then (Requirements 3.7, 5.2). */
  home: HomeEntryController | null;
  /** Current resolved route, recomputed on every controller notification. */
  route: AppRoute;
  /** The raw navigation state for consumers that need the individual pieces. */
  navState: NavState;
  /** Whether onboarding.start() rejected (Requirement 5.3). */
  startFailed: boolean;
  /** Submit the age screen (Requirement 5.5). */
  submitAge(input: { birthMonth: number; birthYear: number }): Promise<void>;
  /** Build the Home_Controller after eligibility; wraps secure-context + failure handling. */
  enterHome(): Promise<void>;
  /** Force a re-read of the home controller status into navState. */
  refreshHomeStatus(): void;
}

// ---------------------------------------------------------------------------
// AppHostFactory — platform-specific construction adapter
// ---------------------------------------------------------------------------

/**
 * Platform-specific construction. The mobile root layout supplies a factory that
 * calls `createMobileApp` with native adapters; the web root layout supplies
 * one that calls `createWebApp` with web adapters. The factory is invoked
 * exactly ONCE inside the provider.
 */
export interface AppHostFactory {
  createApp(): { onboarding: AgeGateOnboardingController; createHome(): Promise<HomeEntryController> };
}

// ---------------------------------------------------------------------------
// React Context
// ---------------------------------------------------------------------------

const AppHostContext = createContext<AppHost | null>(null);

/** Access the AppHost from any descendant. Throws if used outside the provider. */
export function useAppHost(): AppHost {
  const host = useContext(AppHostContext);
  if (host === null) {
    throw new Error('useAppHost must be used within an <AppHostProvider>');
  }
  return host;
}

// ---------------------------------------------------------------------------
// Provider props
// ---------------------------------------------------------------------------

export interface AppHostProviderProps {
  /** Platform-specific factory (called once to compose controllers). */
  factory: AppHostFactory;
  /** Children rendered once the provider is ready. */
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

/**
 * Root provider that composes the app controllers exactly once per launch and
 * exposes them (plus the derived route) to the tree via React context.
 */
export function AppHostProvider({ factory, children }: AppHostProviderProps): React.ReactElement {
  // Use a ref to ensure the factory is invoked exactly ONCE per component
  // lifetime, even under React Strict Mode double-mounts.
  const appRef = useRef<ReturnType<AppHostFactory['createApp']> | null>(null);
  if (appRef.current === null) {
    appRef.current = factory.createApp();
  }
  const app = appRef.current;

  // Navigation state — updated on every controller transition.
  const [navState, setNavState] = useState<NavState>({
    onboarding: app.onboarding.getStatus(),
    home: null,
    secureContextBlocked: false,
    compositionFailed: false,
  });

  // Home controller — set after `enterHome()` resolves.
  const [home, setHome] = useState<HomeEntryController | null>(null);

  // Whether onboarding.start() rejected (Requirement 5.3).
  const [startFailed, setStartFailed] = useState(false);

  // Helper to update the onboarding portion of nav state.
  const updateOnboardingStatus = useCallback((status: OnboardingStatus) => {
    setNavState((prev) => ({ ...prev, onboarding: status }));
  }, []);

  // Start onboarding on mount (Requirement 5.1: call start() before rendering
  // any onboarding step). This runs once.
  useEffect(() => {
    let cancelled = false;
    void app.onboarding.start().then((status) => {
      if (!cancelled) {
        updateOnboardingStatus(status);
      }
    }).catch(() => {
      // Requirement 5.3: if start() rejects, route to age-gate so the screen
      // can surface the start-failure message (it checks startFailed).
      if (!cancelled) {
        setStartFailed(true);
        setNavState((prev) => ({ ...prev, onboarding: 'age-gate' }));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set the initial home status when home controller is created.
  // Status updates are driven by explicit calls to refreshHomeStatus().
  useEffect(() => {
    if (!home) return;
    setNavState((prev) => ({ ...prev, home: home.getStatus() }));
  }, [home]);

  // submitAge: route input through onboarding controller, update nav state.
  const submitAge = useCallback(async (input: { birthMonth: number; birthYear: number }) => {
    const result = await app.onboarding.submitAge(input);
    updateOnboardingStatus(app.onboarding.getStatus());
    // If eligible, the caller should follow up with enterHome(), but we update
    // state here so the route resolves immediately.
    void result; // consumed for its side-effect on the controller
  }, [app.onboarding, updateOnboardingStatus]);

  // enterHome: guard that onboarding is eligible, then construct the Home_Controller.
  const enterHome = useCallback(async () => {
    if (app.onboarding.getStatus() !== 'eligible') {
      // Requirement 3.7: reject if not eligible — never build before eligible.
      throw new Error('enterHome() called before onboarding = eligible (Requirement 3.7)');
    }
    try {
      const controller = await app.createHome();
      setHome(controller);
      setNavState((prev) => ({ ...prev, home: controller.getStatus() }));
    } catch (err: unknown) {
      console.error('[AppHost] enterHome failed:', err);
      // Distinguish SecureContextRequiredError from other failures.
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'SecureContextRequiredError') {
        setNavState((prev) => ({ ...prev, secureContextBlocked: true }));
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setNavState((prev) => ({ ...prev, compositionFailed: true, _errorMessage: msg }));
      }
    }
  }, [app]);

  // Compute the current route from the nav state.
  const route = resolveRoute(navState);

  // refreshHomeStatus: force a re-read of the home controller status into navState.
  // Needed after operations like signIn() that change status without emitting a
  // store notification.
  const refreshHomeStatus = useCallback(() => {
    if (home) {
      const status = home.getStatus();
      console.log('[AppHost] refreshHomeStatus called, home.getStatus():', status);
      setNavState((prev) => ({ ...prev, home: status }));
    } else {
      console.log('[AppHost] refreshHomeStatus called but home is null');
    }
  }, [home]);

  const value: AppHost = {
    onboarding: app.onboarding,
    home,
    route,
    navState,
    startFailed,
    submitAge,
    enterHome,
    refreshHomeStatus,
  };

  return (
    <AppHostContext.Provider value={value}>
      {children}
    </AppHostContext.Provider>
  );
}
