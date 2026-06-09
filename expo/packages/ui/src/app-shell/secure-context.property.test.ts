/**
 * Property-based test for the web secure-context gate (Task 5.4).
 *
 * Property 2: Web secure-context gate blocks exactly when crypto would be refused
 *   When `secureContextBlocked=true`, the navigation resolver returns
 *   'secure-context-required' regardless of all other state (onboarding status,
 *   home status, compositionFailed). When `secureContextBlocked=false` AND the
 *   runtime is a secure context, navigation proceeds normally — the resolver
 *   never returns 'secure-context-required'. The secure-context gate takes
 *   priority over compositionFailed and over any onboarding/home status.
 *
 * **Validates: Requirements 4.2, 4.3, 4.4**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { resolveRoute, type NavState } from './navigation';

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

/**
 * Arbitrary NavState with secureContextBlocked forced to true.
 * All other fields vary freely to prove the gate dominates regardless.
 */
const blockedNavStateArb: fc.Arbitrary<NavState> = fc.record({
  onboarding: onboardingArb,
  home: homeArb,
  secureContextBlocked: fc.constant(true),
  compositionFailed: fc.boolean(),
});

/**
 * Arbitrary NavState with secureContextBlocked forced to false.
 * Represents a secure-context (HTTPS or localhost) runtime.
 */
const unblockedNavStateArb: fc.Arbitrary<NavState> = fc.record({
  onboarding: onboardingArb,
  home: homeArb,
  secureContextBlocked: fc.constant(false),
  compositionFailed: fc.boolean(),
});

/**
 * Full domain NavState for priority assertions.
 */
const navStateArb: fc.Arbitrary<NavState> = fc.record({
  onboarding: onboardingArb,
  home: homeArb,
  secureContextBlocked: fc.boolean(),
  compositionFailed: fc.boolean(),
});

describe('Property 2: Web secure-context gate blocks exactly when crypto would be refused (4.2, 4.3, 4.4)', () => {
  it.prop([blockedNavStateArb], { numRuns: 200 })(
    'secureContextBlocked=true → always returns secure-context-required regardless of all other state',
    (state) => {
      const route = resolveRoute(state);
      // Requirement 4.4: When not in a Secure_Context, the web app SHALL block
      // all application functionality and leave no onboarding or authenticated
      // screen rendered.
      expect(route.name).toBe('secure-context-required');
    },
  );

  it.prop([unblockedNavStateArb], { numRuns: 200 })(
    'secureContextBlocked=false → never returns secure-context-required',
    (state) => {
      const route = resolveRoute(state);
      // Requirement 4.3: When in a Secure_Context, the web app SHALL proceed to
      // construct the Home_Controller — navigation proceeds normally.
      expect(route.name).not.toBe('secure-context-required');
    },
  );

  it.prop([blockedNavStateArb], { numRuns: 200 })(
    'secure-context gate takes priority over compositionFailed',
    (state) => {
      // Even when compositionFailed is also true, secureContextBlocked wins.
      const withBothFlags: NavState = { ...state, compositionFailed: true };
      const route = resolveRoute(withBothFlags);
      expect(route.name).toBe('secure-context-required');
    },
  );

  it.prop([blockedNavStateArb], { numRuns: 200 })(
    'secure-context gate takes priority over onboarding and home statuses',
    (state) => {
      const route = resolveRoute(state);
      // Regardless of whether onboarding is eligible, checking, age-gate, or
      // ineligible, and regardless of whether home is ready, locked, signed-out,
      // or null — the gate blocks.
      expect(route.name).toBe('secure-context-required');
      // Verify the gate prevents any onboarding or authenticated screen
      expect(route.name).not.toBe('age-gate');
      expect(route.name).not.toBe('ineligible');
      expect(route.name).not.toBe('sign-in');
      expect(route.name).not.toBe('unlock');
      expect(route.name).not.toBe('home');
    },
  );

  it.prop([navStateArb], { numRuns: 200 })(
    'secure-context-required appears if and only if secureContextBlocked is true',
    (state) => {
      const route = resolveRoute(state);
      // Biconditional: the route is 'secure-context-required' ⟺ the flag is set.
      if (route.name === 'secure-context-required') {
        expect(state.secureContextBlocked).toBe(true);
      }
      if (state.secureContextBlocked) {
        expect(route.name).toBe('secure-context-required');
      }
    },
  );
});
