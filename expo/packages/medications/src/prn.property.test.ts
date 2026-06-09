/**
 * Property-based test for the PRN 24-hour safety threshold (Task 11.3).
 *
 * Property 14: PRN safety threshold enforcement
 *   The Quick Log is blocked iff the resulting trailing-24h cumulative would be
 *   strictly greater than the safety limit AND no override is acknowledged.
 *   Otherwise the dose is recorded and the projected cumulative reflects exactly
 *   the added amount (existingCumulative + doseAmount).
 *
 * Validates: Requirements 13.5, 13.6
 *
 * Uses @fast-check/vitest for property-based testing integration. Exercises the
 * pure decision `evaluatePrnQuickLog` across random cumulatives, dose amounts,
 * safety limits (including fractional values within the valid [0.01, 999999.99]
 * range), and override acknowledgement.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { evaluatePrnQuickLog } from './index';

// ---------------------------------------------------------------------------
// Generators — constrained to the valid PRN input space, including fractions.
// ---------------------------------------------------------------------------

/** Cumulative already logged in the trailing 24h window: 0 .. 1,000,000. */
const existingCumulativeArb = fc.double({
  min: 0,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A single PRN dose amount: a positive, finite (possibly fractional) value. */
const doseAmountArb = fc.double({
  min: 0.01,
  max: 1_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Safety limit within the validated range [0.01, 999999.99]. */
const safetyLimit24hArb = fc.double({
  min: 0.01,
  max: 999_999.99,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('Property 14: PRN safety threshold enforcement (13.5, 13.6)', () => {
  it.prop([existingCumulativeArb, doseAmountArb, safetyLimit24hArb, fc.boolean()])(
    'blocks iff projected strictly exceeds the limit without an override; otherwise records exactly the added amount',
    (existingCumulative, doseAmount, safetyLimit24h, overrideAcknowledged) => {
      const result = evaluatePrnQuickLog({
        existingCumulative,
        doseAmount,
        safetyLimit24h,
        overrideAcknowledged,
      });

      // The projected cumulative reflects exactly the added amount.
      const projected = existingCumulative + doseAmount;
      expect(result.projectedCumulative).toBe(projected);
      expect(result.existingCumulative).toBe(existingCumulative);

      const overLimit = projected > safetyLimit24h;
      expect(result.withinLimit).toBe(!overLimit);

      // Core invariant: blocked iff over-limit AND not acknowledged.
      expect(result.blocked).toBe(overLimit && !overrideAcknowledged);

      // recorded and blocked are mutually exclusive (exactly one is true).
      expect(result.recorded).toBe(!result.blocked);

      if (result.blocked) {
        // Blocked: nothing recorded, no override flag.
        expect(result.recorded).toBe(false);
        expect(result.overrideFlag).toBe(false);
      } else {
        // Not blocked: the dose is recorded.
        expect(result.recorded).toBe(true);
        // Override flag is set exactly when the recorded dose exceeds the limit.
        expect(result.overrideFlag).toBe(overLimit);
        if (overLimit) {
          // Over-limit but acknowledged → recorded as an override.
          expect(overrideAcknowledged).toBe(true);
          expect(result.overrideFlag).toBe(true);
        } else {
          // At-or-below the limit is always recorded without an override flag.
          expect(result.overrideFlag).toBe(false);
        }
      }
    },
  );
});
