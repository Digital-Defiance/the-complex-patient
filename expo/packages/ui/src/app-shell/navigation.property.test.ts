/**
 * Property-based test for the navigation resolver (Task 2.2).
 *
 * Property 1: Navigation is a total, correct projection of controller status
 *   For any combination of (onboarding, home, secureContextBlocked,
 *   compositionFailed), `resolveRoute` never throws, always returns a valid
 *   AppRoute, correctly projects the two shell-level gates, correctly gates
 *   authenticated routes behind `onboarding = 'eligible'`, maps
 *   `checking`/null → loading, and is deterministic (same input → same output).
 *
 * **Validates: Requirements 3.6, 3.7, 5.2, 5.7, 6.1, 6.3, 7.1, 7.2, 7.6, 8.1, 8.2, 8.3**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { resolveRoute, type NavState, type AppRoute } from './navigation';

// ---------------------------------------------------------------------------
// Generators — cover the full domain of NavState.
// ---------------------------------------------------------------------------

const onboardingArb = fc.constantFrom(
  'checking' as const,
  'age-gate' as const,
  'ineligible' as const,
  'eligible' as const,
);

const homeArb = fc.constantFrom(
  'signed-out' as const,
  'locked' as const,
  'ready' as const,
  null,
);

const navStateArb: fc.Arbitrary<NavState> = fc.record({
  onboarding: onboardingArb,
  home: homeArb,
  secureContextBlocked: fc.boolean(),
  compositionFailed: fc.boolean(),
});

/** All valid route names the resolver may return. */
const VALID_ROUTE_NAMES: ReadonlySet<AppRoute['name']> = new Set([
  'loading',
  'age-gate',
  'ineligible',
  'secure-context-required',
  'composition-failed',
  'sign-in',
  'unlock',
  'home',
]);

describe('Property 1: Navigation is a total, correct projection of controller status (3.6, 3.7, 5.2, 5.7, 6.1, 6.3, 7.1, 7.2, 7.6, 8.1, 8.2, 8.3)', () => {
  it.prop([navStateArb], { numRuns: 200 })(
    'is total: never throws and always returns a valid AppRoute',
    (state) => {
      const route = resolveRoute(state);
      expect(route).toBeDefined();
      expect(route).toHaveProperty('name');
      expect(VALID_ROUTE_NAMES.has(route.name)).toBe(true);
    },
  );

  it.prop([navStateArb], { numRuns: 200 })(
    'correct projection: secureContextBlocked → secure-context-required, compositionFailed → composition-failed',
    (state) => {
      const route = resolveRoute(state);
      if (state.secureContextBlocked) {
        // secureContextBlocked takes highest priority (Requirement 4.4)
        expect(route.name).toBe('secure-context-required');
      } else if (state.compositionFailed) {
        // compositionFailed takes second priority (Requirements 3.8, 4.5)
        expect(route.name).toBe('composition-failed');
      }
    },
  );

  it.prop([navStateArb], { numRuns: 200 })(
    'authenticated routes are gated: sign-in/unlock/home only when onboarding = eligible',
    (state) => {
      const route = resolveRoute(state);
      const authenticatedRoutes = new Set(['sign-in', 'unlock', 'home']);
      if (authenticatedRoutes.has(route.name)) {
        // If we got an authenticated route, onboarding must be eligible
        // AND the shell gates must be clear (Requirements 3.6, 3.7)
        expect(state.onboarding).toBe('eligible');
        expect(state.secureContextBlocked).toBe(false);
        expect(state.compositionFailed).toBe(false);
      }
    },
  );

  it.prop([navStateArb], { numRuns: 200 })(
    'checking/null → loading: indeterminate states resolve to loading',
    (state) => {
      const route = resolveRoute(state);
      // When gates are clear and onboarding is 'checking', route must be loading
      if (!state.secureContextBlocked && !state.compositionFailed && state.onboarding === 'checking') {
        expect(route.name).toBe('loading');
      }
      // When gates are clear, onboarding is 'eligible', and home is null, route must be loading
      if (!state.secureContextBlocked && !state.compositionFailed && state.onboarding === 'eligible' && state.home === null) {
        expect(route.name).toBe('loading');
      }
    },
  );

  it.prop([navStateArb], { numRuns: 200 })(
    'is deterministic: same input always produces the same output',
    (state) => {
      const a = resolveRoute(state);
      const b = resolveRoute({ ...state });
      expect(b).toEqual(a);
    },
  );
});
