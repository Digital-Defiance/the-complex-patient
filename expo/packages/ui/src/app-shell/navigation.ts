/**
 * @complex-patient/ui — Shell navigation resolver and shared route/state types
 *
 * The app-shell layer is the platform-agnostic UI surface shared identically by
 * the mobile (Expo Router) and web (React Native Web) targets. This module is
 * its single source of truth for "which screen is shown": a pure, synchronous
 * projection of the two controller statuses (onboarding + home) plus the two
 * shell-level gates (secure-context, composition failure) onto a concrete
 * {@link AppRoute}.
 *
 * Keeping the mapping pure and total makes it exhaustively unit- and
 * property-testable (design.md → Property 1) and makes the shown screen
 * provably consistent with controller state. The shell never stores navigation
 * state independently; it re-derives the route on every controller
 * notification.
 *
 * Critically, onboarding gates everything: the authenticated routes
 * (`sign-in`, `unlock`, `home`) are only ever reachable when
 * `onboarding = 'eligible'`. Any indeterminate input (`onboarding = 'checking'`
 * or a still-null `home`) falls back to the non-committal `loading` route
 * (Requirements 3.6, 3.7, 4.4, 5.2, 5.7, 6.1, 6.3, 7.1, 7.2, 7.6, 8.1, 8.2, 8.3).
 */

import type { OnboardingStatus, HomeStatus } from '../app';

/**
 * Every screen the shell can show.
 *
 * - `loading`: indeterminate (onboarding still `checking`, or `home` not yet
 *   resolved) — no committed screen (Requirements 5.7, 7.6).
 * - `age-gate` / `ineligible`: onboarding screens (Requirements 5.2, 6.1, 6.3).
 * - `secure-context-required`: web-only blocking screen shown when crypto would
 *   be refused outside a Secure_Context (Requirement 4.4).
 * - `composition-failed`: `createMobileApp` / `createHome` rejected for a
 *   non-secure-context reason (Requirements 3.8, 4.5).
 * - `sign-in` / `unlock` / `home`: authenticated routes, only reachable when
 *   `onboarding = 'eligible'` (Requirements 7.1, 7.2, 8.1).
 */
export type AppRoute =
  | { name: 'loading' }
  | { name: 'age-gate' }
  | { name: 'ineligible' }
  | { name: 'secure-context-required' } // web-only blocking screen (4.4)
  | { name: 'composition-failed' }      // createHome / createMobileApp failure (3.8, 4.5)
  | { name: 'sign-in' }
  | { name: 'unlock' }
  | { name: 'home' };

/** Inputs to the resolver: the two controller statuses plus shell-level gates. */
export interface NavState {
  /** Age-gate controller status. 'checking' | 'age-gate' | 'ineligible' | 'eligible'. */
  onboarding: OnboardingStatus;
  /** Home controller status; null until createHome() resolves. */
  home: HomeStatus | null;
  /** Web: createHome threw SecureContextRequiredError (Requirement 4.4). */
  secureContextBlocked: boolean;
  /** createMobileApp/createHome rejected for a non-secure-context reason (3.8, 4.5). */
  compositionFailed: boolean;
}

/**
 * Pure status→route projection (Requirements 3.6, 4.4, 5.2, 6.1, 6.3, 7.1, 7.2,
 * 8.1). Onboarding gates everything: home routes are only reachable when
 * eligible. The two shell gates take precedence over the controller statuses so
 * a blocked or failed composition can never surface onboarding/authenticated
 * content.
 */
export function resolveRoute(s: NavState): AppRoute {
  if (s.secureContextBlocked) return { name: 'secure-context-required' };
  if (s.compositionFailed) return { name: 'composition-failed' };
  switch (s.onboarding) {
    case 'checking':
      return { name: 'loading' };
    case 'age-gate':
      return { name: 'age-gate' };
    case 'ineligible':
      return { name: 'ineligible' };
    case 'eligible':
      switch (s.home) {
        case 'signed-out':
          return { name: 'sign-in' };
        case 'locked':
          return { name: 'unlock' };
        case 'ready':
          return { name: 'home' };
        case null:
        default:
          return { name: 'loading' };
      }
    default:
      // Exhaustive over OnboardingStatus; any unexpected value is non-committal.
      return { name: 'loading' };
  }
}
