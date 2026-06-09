/**
 * Smoke test verifying the test runner (Vitest) and property-based testing
 * library (fast-check) are correctly configured.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('workspace smoke test', () => {
  it('vitest runs correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('fast-check is available for property-based testing', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
    );
  });
});
