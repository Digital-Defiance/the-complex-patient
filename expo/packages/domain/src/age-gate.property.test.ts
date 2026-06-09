/**
 * Property-based test for the age eligibility gate (Task 2.6).
 *
 * Property 18: Age gate is deterministic and threshold-correct
 *   For any birth month/year input and any reference instant `now`,
 *   `evaluateAgeGate` produces exactly one outcome: `INVALID_AGE_INPUT` for a
 *   missing/out-of-range/non-past month-year; `eligible:false` when the end of
 *   the birth month plus 16 years is strictly after `now`; and `eligible:true`
 *   when the end of the birth month plus 16 years is on or before `now`. The
 *   function is pure and deterministic in `(input, now)`, and an ineligible or
 *   invalid result never yields an eligible outcome.
 *
 * Validates: Requirements 23.2, 23.3, 23.5, 23.9
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { evaluateAgeGate, MINIMUM_AGE_YEARS, type AgeGateInput } from './age-gate';

// ---------------------------------------------------------------------------
// Generators — deliberately wide so they straddle the valid/invalid boundary.
// ---------------------------------------------------------------------------

/** Month spanning well beyond the valid 1–12 range, plus non-integers. */
const monthArb = fc.oneof(
  fc.integer({ min: -3, max: 16 }),
  fc.constantFrom(0, 1, 12, 13, 6.5, NaN),
);

/** Year spanning beyond the valid four-digit range, plus non-integers. */
const yearArb = fc.oneof(
  fc.integer({ min: 900, max: 10_050 }),
  fc.constantFrom(999, 1000, 9999, 10000, 2000.5, NaN),
);

const inputArb: fc.Arbitrary<AgeGateInput> = fc.record({
  birthMonth: monthArb,
  birthYear: yearArb,
});

/** `now` spanning a wide range of instants. */
const nowArb = fc
  .integer({ min: Date.UTC(1500, 0, 1), max: Date.UTC(10_100, 0, 1) })
  .map((ms) => new Date(ms));

/**
 * Reference oracle: an independent reimplementation of the spec, used to assert
 * the function's outcome rather than mirroring its internal arithmetic.
 */
function expectedOutcome(
  input: AgeGateInput,
  now: Date,
): 'invalid' | 'eligible' | 'ineligible' {
  const { birthMonth, birthYear } = input;
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) return 'invalid';
  if (!Number.isInteger(birthYear) || birthYear < 1000 || birthYear > 9999) return 'invalid';

  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const strictlyPast =
    birthYear < nowYear || (birthYear === nowYear && birthMonth < nowMonth);
  if (!strictlyPast) return 'invalid';

  const threshold = Date.UTC(birthYear + MINIMUM_AGE_YEARS, birthMonth, 1, 0, 0, 0, 0);
  return now.getTime() >= threshold ? 'eligible' : 'ineligible';
}

describe('Property 18: age gate is deterministic and threshold-correct (23.2, 23.3, 23.5, 23.9)', () => {
  it.prop([inputArb, nowArb])(
    'produces exactly one of the three outcomes and never reports eligible on an invalid/ineligible result',
    (input, now) => {
      const result = evaluateAgeGate(input, now);

      // The result is always one of exactly three shapes (mutually exclusive).
      if (result.ok === false) {
        expect(result.error).toBe('INVALID_AGE_INPUT');
        // An invalid result never carries an eligible flag.
        expect('eligible' in result).toBe(false);
      } else {
        expect(result.ok).toBe(true);
        expect(typeof result.eligible).toBe('boolean');
      }
    },
  );

  it.prop([inputArb, nowArb])(
    'matches an independent threshold oracle',
    (input, now) => {
      const result = evaluateAgeGate(input, now);
      const expected = expectedOutcome(input, now);

      if (expected === 'invalid') {
        expect(result).toEqual({ ok: false, error: 'INVALID_AGE_INPUT' });
      } else if (expected === 'eligible') {
        expect(result).toEqual({ ok: true, eligible: true });
      } else {
        expect(result).toEqual({ ok: true, eligible: false });
      }
    },
  );

  it.prop([inputArb, nowArb])(
    'is deterministic: identical inputs produce identical outputs',
    (input, now) => {
      const a = evaluateAgeGate(input, now);
      const b = evaluateAgeGate({ ...input }, new Date(now.getTime()));
      expect(b).toEqual(a);
    },
  );

  it.prop([inputArb, nowArb])(
    'never reports eligible:true for an invalid or under-age input',
    (input, now) => {
      const result = evaluateAgeGate(input, now);
      const eligibleTrue = result.ok === true && result.eligible === true;
      if (eligibleTrue) {
        // If eligible:true, the oracle must also classify it eligible.
        expect(expectedOutcome(input, now)).toBe('eligible');
      }
    },
  );
});
