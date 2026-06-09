/**
 * Age eligibility gate (Requirement 23).
 *
 * A pre-vault onboarding control: a self-attested birth month/year check applied
 * uniformly with a fixed minimum age of 16 and no locality detection. It is a
 * stated-eligibility control, not an identity or jurisdiction check.
 *
 * `evaluateAgeGate` is a pure, deterministic function of `(input, now)` with
 * `now` injected for testability. Only birth month and year are collected
 * (no full date of birth), and neither value is ever transmitted off-device.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.9, 23.10
 */

/** Fixed minimum age applied uniformly with no locality logic (23.2). */
export const MINIMUM_AGE_YEARS = 16;

/**
 * Self-attested birth month and year.
 *
 * - `birthMonth`: integer 1–12
 * - `birthYear`: four-digit calendar year
 */
export interface AgeGateInput {
  birthMonth: number;
  birthYear: number;
}

/**
 * Result of evaluating the age gate.
 *
 * - `{ ok: true; eligible: true }`  — valid input, at or above the minimum age
 * - `{ ok: true; eligible: false }` — valid input, under the minimum age → block
 * - `{ ok: false; error: 'INVALID_AGE_INPUT' }` — missing/out-of-range/non-past
 */
export type AgeGateResult =
  | { ok: true; eligible: true }
  | { ok: true; eligible: false }
  | { ok: false; error: 'INVALID_AGE_INPUT' };

/**
 * Evaluates age eligibility against the fixed 16-year minimum.
 *
 * Validation (→ `INVALID_AGE_INPUT`, Requirement 23.9):
 * - `birthMonth` is not an integer in 1–12, or
 * - `birthYear` is not a four-digit calendar year (1000–9999), or
 * - the supplied (year, month) is not strictly in the past relative to `now`
 *   (i.e. the current month-year and any future month-year are rejected).
 *
 * Eligibility (Requirement 23.3):
 * Computed conservatively by treating the birthday as the END of the supplied
 * birth month. The user is eligible only when
 * `endOfMonth(birthYear, birthMonth) + 16 years <= now`. The end of the birth
 * month is the first instant of the following month, so the threshold is the
 * first instant of `(birthMonth + 1)` in `birthYear + 16`. A user who is 15 and
 * 11 months is therefore blocked rather than rounded up.
 *
 * All instants are computed in UTC so the result is independent of the host
 * timezone and depends only on `(input, now)`.
 */
export function evaluateAgeGate(input: AgeGateInput, now: Date): AgeGateResult {
  const { birthMonth, birthYear } = input;

  // Validate birth month: integer in 1–12.
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) {
    return { ok: false, error: 'INVALID_AGE_INPUT' };
  }

  // Validate birth year: four-digit calendar year.
  if (!Number.isInteger(birthYear) || birthYear < 1000 || birthYear > 9999) {
    return { ok: false, error: 'INVALID_AGE_INPUT' };
  }

  // The reference instant must be a usable Date.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return { ok: false, error: 'INVALID_AGE_INPUT' };
  }

  // The (year, month) must be strictly in the past relative to `now` (23.9).
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1; // 1–12
  const isStrictlyPast =
    birthYear < nowYear || (birthYear === nowYear && birthMonth < nowMonth);
  if (!isStrictlyPast) {
    return { ok: false, error: 'INVALID_AGE_INPUT' };
  }

  // Threshold = end of birth month + 16 years, expressed as the first instant of
  // the month following the birth month, in birthYear + MINIMUM_AGE_YEARS.
  // `birthMonth` (1–12) as a 0-indexed JS month is the month AFTER the birth
  // month; month index 12 correctly rolls over into January of the next year.
  const threshold = Date.UTC(birthYear + MINIMUM_AGE_YEARS, birthMonth, 1, 0, 0, 0, 0);

  const eligible = now.getTime() >= threshold;
  return eligible ? { ok: true, eligible: true } : { ok: true, eligible: false };
}
