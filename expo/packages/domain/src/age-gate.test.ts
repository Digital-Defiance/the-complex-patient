/**
 * Unit tests for the age eligibility gate (Task 2.6).
 *
 * Covers the 16th-birthday boundary (15y11m blocked, exactly-16-at-end-of-month
 * eligible, clearly-over-16 eligible), invalid/missing/future month-year
 * rejection, current-month-year rejection, and determinism with an injected
 * fixed `now`.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.9, 23.10
 */
import { describe, it, expect } from 'vitest';
import { evaluateAgeGate, MINIMUM_AGE_YEARS, type AgeGateResult } from './age-gate';

/** Helper: a fixed reference instant in UTC. */
function at(year: number, month1to12: number, day = 15): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day, 12, 0, 0, 0));
}

describe('evaluateAgeGate — minimum age constant', () => {
  it('uses a fixed minimum age of 16 years', () => {
    expect(MINIMUM_AGE_YEARS).toBe(16);
  });
});

describe('evaluateAgeGate — 16th-birthday boundary (Req 23.3)', () => {
  // Birth: June 2000. End of birth month = start of July 2000.
  // Threshold (end of month + 16y) = start of July 2016.
  const birth = { birthMonth: 6, birthYear: 2000 };

  it('blocks a user who is 15 years 11 months', () => {
    // now = end of May 2016 → user turns "16 at end of month" only in July 2016.
    const result = evaluateAgeGate(birth, at(2016, 5, 31));
    expect(result).toEqual({ ok: true, eligible: false });
  });

  it('blocks just before the threshold (30 June 2016, last instant before July)', () => {
    const result = evaluateAgeGate(birth, new Date(Date.UTC(2016, 5, 30, 23, 59, 59, 999)));
    expect(result).toEqual({ ok: true, eligible: false });
  });

  it('is eligible exactly at the end of the birth month + 16 years (1 July 2016 00:00 UTC)', () => {
    const result = evaluateAgeGate(birth, new Date(Date.UTC(2016, 6, 1, 0, 0, 0, 0)));
    expect(result).toEqual({ ok: true, eligible: true });
  });

  it('is eligible for a clearly-over-16 user', () => {
    const result = evaluateAgeGate(birth, at(2030, 1, 1));
    expect(result).toEqual({ ok: true, eligible: true });
  });

  it('handles December births rolling into the next January threshold', () => {
    // Birth Dec 2000 → end of month = start of Jan 2001 → threshold = start of Jan 2017.
    const decBirth = { birthMonth: 12, birthYear: 2000 };
    expect(evaluateAgeGate(decBirth, new Date(Date.UTC(2016, 11, 31, 23, 59, 59, 999)))).toEqual({
      ok: true,
      eligible: false,
    });
    expect(evaluateAgeGate(decBirth, new Date(Date.UTC(2017, 0, 1, 0, 0, 0, 0)))).toEqual({
      ok: true,
      eligible: true,
    });
  });
});

describe('evaluateAgeGate — invalid month (Req 23.9)', () => {
  const now = at(2024, 6);

  it('rejects month 0', () => {
    expect(evaluateAgeGate({ birthMonth: 0, birthYear: 2000 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects month 13', () => {
    expect(evaluateAgeGate({ birthMonth: 13, birthYear: 2000 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects negative month', () => {
    expect(evaluateAgeGate({ birthMonth: -1, birthYear: 2000 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects non-integer month', () => {
    expect(evaluateAgeGate({ birthMonth: 6.5, birthYear: 2000 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects NaN month', () => {
    expect(evaluateAgeGate({ birthMonth: NaN, birthYear: 2000 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });
});

describe('evaluateAgeGate — invalid year (Req 23.9)', () => {
  const now = at(2024, 6);

  it('rejects a three-digit year', () => {
    expect(evaluateAgeGate({ birthMonth: 6, birthYear: 999 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects a five-digit year', () => {
    expect(evaluateAgeGate({ birthMonth: 6, birthYear: 10000 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects a non-integer year', () => {
    expect(evaluateAgeGate({ birthMonth: 6, birthYear: 2000.5 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects NaN year', () => {
    expect(evaluateAgeGate({ birthMonth: 6, birthYear: NaN }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });
});

describe('evaluateAgeGate — non-past month-year (Req 23.9)', () => {
  it('rejects the current month-year', () => {
    const now = at(2024, 6);
    expect(evaluateAgeGate({ birthMonth: 6, birthYear: 2024 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects a future month in the current year', () => {
    const now = at(2024, 6);
    expect(evaluateAgeGate({ birthMonth: 7, birthYear: 2024 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('rejects a future year', () => {
    const now = at(2024, 6);
    expect(evaluateAgeGate({ birthMonth: 1, birthYear: 2025 }, now)).toEqual({
      ok: false,
      error: 'INVALID_AGE_INPUT',
    });
  });

  it('accepts a strictly-past month in the current year as valid input', () => {
    const now = at(2024, 6);
    // May 2024 is in the past; clearly under 16 so eligible:false (valid input).
    expect(evaluateAgeGate({ birthMonth: 5, birthYear: 2024 }, now)).toEqual({
      ok: true,
      eligible: false,
    });
  });
});

describe('evaluateAgeGate — determinism with injected `now`', () => {
  it('returns the same result for repeated calls with identical inputs', () => {
    const input = { birthMonth: 3, birthYear: 2005 };
    const now = at(2024, 6);
    const first = evaluateAgeGate(input, now);
    const second = evaluateAgeGate(input, now);
    const third = evaluateAgeGate({ ...input }, new Date(now.getTime()));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('does not depend on wall-clock time (only on the injected `now`)', () => {
    const input = { birthMonth: 1, birthYear: 1990 };
    const result: AgeGateResult = evaluateAgeGate(input, at(2024, 1, 1));
    expect(result).toEqual({ ok: true, eligible: true });
  });
});
