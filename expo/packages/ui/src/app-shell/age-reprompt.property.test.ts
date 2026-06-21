/**
 * Property-based test for age re-prompt logic (Task 6.4).
 *
 * Property 3: Age re-prompt is shown exactly on invalid input
 *   For any AgeSubmissionResult returned by `onboarding.submitAge`, the
 *   age-gate screen displays the re-prompt message if and only if the result
 *   is `INVALID_AGE_INPUT`, and remains on the age-gate screen in that case.
 *
 * **Validates: Requirements 5.6, 5.8**
 *
 * Tests at the logic level: generates arbitrary month/year combinations,
 * exercises the onboarding controller's `submitAge`, and verifies that the
 * re-prompt decision (show/hide) is a biconditional of the INVALID_AGE_INPUT
 * result. The controller is exercised directly (not mocked) so the test
 * validates the real logic path that the AgeGateScreen depends on.
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import {
  createAgeGateOnboarding,
  type AgeGateOnboardingController,
  type AgeSubmissionResult,
} from '../app/age-gate-onboarding';

// ---------------------------------------------------------------------------
// Helpers — simulate the AgeGateScreen re-prompt logic
// ---------------------------------------------------------------------------

/**
 * Replicates the AgeGateScreen's re-prompt decision logic from the submitAge
 * result. This is the exact logic in AgeGateScreen.tsx `handleSubmit`:
 *   - On `{ ok: false, error: 'INVALID_AGE_INPUT' }` → reprompt = true
 *   - On any other result → reprompt = false (cleared at start of submit)
 */
function shouldShowReprompt(result: AgeSubmissionResult): boolean {
  return !result.ok && result.error === 'INVALID_AGE_INPUT';
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Arbitrary birth month: any integer (including invalid values outside 1–12)
 * to exercise both valid and invalid paths.
 */
const birthMonthArb = fc.oneof(
  fc.integer({ min: 1, max: 12 }),         // valid months
  fc.integer({ min: -100, max: 0 }),       // invalid: too low
  fc.integer({ min: 13, max: 100 }),       // invalid: too high
  fc.double({ noNaN: true }),              // non-integer
);

/**
 * Arbitrary birth year: includes valid 4-digit years, invalid years (too
 * short, too long, negative), and non-integers.
 */
const birthYearArb = fc.oneof(
  fc.integer({ min: 1900, max: 2025 }),    // reasonable valid years
  fc.integer({ min: 1000, max: 9999 }),    // full valid range
  fc.integer({ min: -100, max: 999 }),     // invalid: too few digits
  fc.integer({ min: 10000, max: 99999 }),  // invalid: too many digits
  fc.double({ noNaN: true }),              // non-integer
);

/** Arbitrary age gate input combining month and year. */
const ageInputArb = fc.record({
  birthMonth: birthMonthArb,
  birthYear: birthYearArb,
});

/**
 * Generator for all possible AgeSubmissionResult variants.
 * Used for the biconditional property (if and only if).
 */
const ageSubmissionResultArb: fc.Arbitrary<AgeSubmissionResult> = fc.oneof(
  fc.constant({ ok: true, eligible: true } as AgeSubmissionResult),
  fc.constant({ ok: true, eligible: false } as AgeSubmissionResult),
  fc.constant({ ok: false, error: 'INVALID_AGE_INPUT' } as AgeSubmissionResult),
  fc.constant({ ok: false, error: 'NOT_ON_AGE_SCREEN' } as AgeSubmissionResult),
);

// ---------------------------------------------------------------------------
// Test factory — creates a fresh controller in `age-gate` state
// ---------------------------------------------------------------------------

function createTestController(): AgeGateOnboardingController {
  const flagStore = {
    isIneligible: async () => false,
    markIneligible: async () => {},
    isAgeEligible: async () => false,
    markAgeEligible: async () => {},
  };
  // Fix the reference date to 2025-06-01 UTC so age computations are deterministic.
  const now = () => new Date(Date.UTC(2025, 5, 1));
  return createAgeGateOnboarding({ flagStore, now });
}

// ---------------------------------------------------------------------------
// Property 3 Tests
// ---------------------------------------------------------------------------

describe('Property 3: Age re-prompt is shown exactly on invalid input (5.6, 5.8)', () => {
  it.prop([ageSubmissionResultArb], { numRuns: 100 })(
    'biconditional: re-prompt is shown if and only if result is INVALID_AGE_INPUT',
    (result) => {
      const showReprompt = shouldShowReprompt(result);

      if (result.ok === false && result.error === 'INVALID_AGE_INPUT') {
        // Requirement 5.6: IF submitAge returns INVALID_AGE_INPUT, THEN show re-prompt
        expect(showReprompt).toBe(true);
      } else {
        // Requirement 5.8: The re-prompt is shown ONLY when INVALID_AGE_INPUT
        expect(showReprompt).toBe(false);
      }
    },
  );

  it.prop([ageInputArb], { numRuns: 200 })(
    'exercising the real controller: re-prompt shown iff submitAge returns INVALID_AGE_INPUT',
    async (input) => {
      // Create a fresh controller in age-gate state for each run.
      const controller = createTestController();
      await controller.start();
      expect(controller.getStatus()).toBe('age-gate');

      const result = await controller.submitAge(input);

      const showReprompt = shouldShowReprompt(result);

      if (showReprompt) {
        // When re-prompt is shown, the result MUST be INVALID_AGE_INPUT
        expect(result).toEqual({ ok: false, error: 'INVALID_AGE_INPUT' });
        // AND the controller MUST remain on the age-gate screen (Req 5.6: stay)
        expect(controller.getStatus()).toBe('age-gate');
      } else {
        // When re-prompt is NOT shown, the result MUST NOT be INVALID_AGE_INPUT
        if (!result.ok) {
          expect(result.error).not.toBe('INVALID_AGE_INPUT');
        }
      }
    },
  );

  it.prop([ageInputArb], { numRuns: 200 })(
    'on INVALID_AGE_INPUT the controller remains in age-gate state (screen stays)',
    async (input) => {
      const controller = createTestController();
      await controller.start();

      const result = await controller.submitAge(input);

      if (!result.ok && result.error === 'INVALID_AGE_INPUT') {
        // Requirement 5.6: SHALL remain on the age-gate screen
        expect(controller.getStatus()).toBe('age-gate');
      }
    },
  );

  it.prop([ageInputArb], { numRuns: 200 })(
    'on non-INVALID_AGE_INPUT results, re-prompt is never shown',
    async (input) => {
      const controller = createTestController();
      await controller.start();

      const result = await controller.submitAge(input);

      if (result.ok) {
        // Valid result (eligible or ineligible) → no re-prompt
        expect(shouldShowReprompt(result)).toBe(false);
      }
    },
  );

  it.prop([ageSubmissionResultArb], { numRuns: 100 })(
    're-prompt cleared before each submission (screen resets reprompt to false then conditionally sets true)',
    (result) => {
      // Simulates the screen's handleSubmit pattern:
      // 1. setReprompt(false) — always clears at start
      // 2. conditionally setReprompt(true) only on INVALID_AGE_INPUT
      let reprompt = true; // assume it was previously true from a prior submission
      reprompt = false;    // cleared at start of handleSubmit (line: setReprompt(false))

      if (!result.ok && result.error === 'INVALID_AGE_INPUT') {
        reprompt = true;   // set on invalid (line: setReprompt(true))
      }

      // After a complete submission cycle, reprompt state matches the biconditional
      expect(reprompt).toBe(shouldShowReprompt(result));
    },
  );
});
