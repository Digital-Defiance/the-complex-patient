/**
 * @complex-patient/insights — Temporal correlation detection and insight cards
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6
 *
 * This module detects temporal correlations between medication events and
 * symptom severity over the trailing 30 calendar days and renders them as
 * plain-language {@link AIInsightCard}s. Like the variance pipeline (13.1), it
 * is a **pure, in-memory computation**:
 *
 * - It reads already-decrypted data from an injected {@link VaultDataSource}
 *   and an injected {@link Clock}; it performs NO network I/O and never touches
 *   any HTTP client, `fetch`, header, or query parameter (19.1, 19.2 carried
 *   forward from 13.1).
 * - It pairs each medication variable's daily "taken-dose" signal with each
 *   symptom variable's daily mean severity across candidate lags 0–14 days
 *   (20.1) and computes a Pearson correlation plus a two-tailed Student's-t
 *   p-value per candidate.
 * - It produces exactly one outcome, mirroring the design's "Insights
 *   invariants" so the gating is mutually exclusive (Property 17 / 13.4):
 *     1. `insufficient-data` — <14 days of tracking history OR <10 paired
 *        medication-and-symptom observations (20.3); no cards.
 *     2. `no-significant-correlations` — thresholds met but no candidate is at
 *        or below the significance threshold (20.4).
 *     3. `ok` — one card per significant correlation, at most 10, ordered by
 *        ascending p-value (20.2, 20.5).
 *     4. `error` — computation failed; vault left unchanged, nothing
 *        transmitted (carried forward from 19.7).
 * - It never mutates the {@link VaultDataSource}.
 */

import type { SymptomEntry, PrnLog } from '@complex-patient/domain';
import { systemClock } from './pipeline';
import {
  ANALYSIS_FAILED_MESSAGE,
  ANALYSIS_WINDOW_DAYS,
  type Clock,
  type MedEvent,
  type VaultDataSource,
} from './types';

/** Milliseconds in one calendar day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Smallest candidate lag, in days (20.1). */
export const MIN_LAG_DAYS = 0;

/** Largest candidate lag, in days (20.1). */
export const MAX_LAG_DAYS = 14;

/** Default significance threshold; a correlation is significant when p ≤ this (20.2). */
export const DEFAULT_SIGNIFICANCE_THRESHOLD = 0.05;

/** Maximum number of insight cards rendered for a single analysis (20.5). */
export const MAX_INSIGHT_CARDS = 10;

/**
 * Minimum days of tracking history required before any card is produced (20.3).
 * "Tracking history" is the count of distinct in-window calendar days that
 * carry at least one symptom or medication record.
 */
export const MIN_TRACKING_DAYS = 14;

/**
 * Minimum paired medication-and-symptom observations required before any card
 * is produced (20.3). A "paired observation" is an in-window calendar day that
 * carries both at least one symptom record and at least one medication record.
 */
export const MIN_PAIRED_OBSERVATIONS = 10;

/**
 * Minimum number of (medication, symptom) data points a single lag candidate
 * needs before a correlation/p-value can be computed. A two-tailed t-test needs
 * at least one degree of freedom, so n must exceed 2.
 */
const MIN_POINTS_PER_CANDIDATE = 3;

/** User-facing message for the insufficient-history / insufficient-pairs gate (20.3). */
export const INSUFFICIENT_HISTORY_MESSAGE =
  'Not enough tracking history to detect correlations. Keep logging symptoms and medications — at least 14 days of history and 10 paired observations are needed.';

/** User-facing message when data was analyzed but nothing was significant (20.4). */
export const NO_SIGNIFICANT_CORRELATIONS_MESSAGE =
  'Your data was analyzed, but no significant correlations were found.';

/**
 * A single detected correlation between a medication variable and a symptom
 * variable at a particular lag (design "Insights Domain").
 */
export interface CorrelationResult {
  medicationVariable: string;
  symptomVariable: string;
  direction: 'positive' | 'negative';
  /** Candidate lag in days, in `[0, 14]` (20.1). */
  lagDays: number;
  /** Two-tailed significance; significant when `≤ threshold` (20.2). */
  pValue: number;
}

/**
 * A plain-language insight card (design "Insights Domain"). It names the two
 * correlated variables, the direction of the correlation, and the lag (20.2).
 */
export interface AIInsightCard {
  variables: [string, string];
  direction: 'positive' | 'negative';
  lagDays: number;
}

/**
 * Discriminated result of a correlation analysis. Exactly one outcome is
 * produced, so the three data-bearing statuses are mutually exclusive (Property
 * 17 / 13.4 asserts this).
 */
export type CorrelationOutcome =
  | {
      status: 'ok';
      /** One card per significant correlation, ascending p-value, ≤10 (20.5). */
      cards: AIInsightCard[];
      /** The underlying significant correlations, aligned 1:1 with `cards`. */
      correlations: CorrelationResult[];
      /** Wall-clock duration of the computation in milliseconds (20.6 budget). */
      durationMs: number;
    }
  | {
      status: 'no-significant-correlations';
      message: string;
      durationMs: number;
    }
  | {
      status: 'insufficient-data';
      message: string;
      trackingDays: number;
      pairedObservations: number;
    }
  | {
      status: 'error';
      message: string;
    };

/** Options controlling correlation detection. */
export interface DetectCorrelationsOptions {
  /** Significance threshold; defaults to {@link DEFAULT_SIGNIFICANCE_THRESHOLD}. */
  significanceThreshold?: number;
}

/** The integer UTC day index for an instant (days since the Unix epoch). */
function dayIndex(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

/** Inclusive lower bound of the trailing window: `now - 30 days`. */
function windowStart(now: Date): number {
  return now.getTime() - ANALYSIS_WINDOW_DAYS * MS_PER_DAY;
}

/**
 * Parse an ISO timestamp and return its day index when it falls within
 * `[now - 30d, now]`, or `null` otherwise. Unparseable timestamps are excluded
 * so malformed data can never widen the analysis set.
 */
function inWindowDay(iso: string, startMs: number, nowMs: number): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t < startMs || t > nowMs) {
    return null;
  }
  return dayIndex(t);
}

/** The timestamp that anchors a medication event: when taken, else scheduled. */
function medEventTimestamp(event: MedEvent): string {
  return event.takenAt ?? event.scheduledAt;
}

/** Pearson correlation of two equal-length series; `null` if undefined. */
function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < MIN_POINTS_PER_CANDIDATE) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  // A constant series has zero variance and an undefined correlation.
  if (varX === 0 || varY === 0) {
    return null;
  }
  const r = cov / Math.sqrt(varX * varY);
  // Clamp to guard against floating-point drift past ±1.
  return Math.max(-1, Math.min(1, r));
}

/**
 * Continued-fraction evaluation of the incomplete beta function (Numerical
 * Recipes `betacf`). Used by {@link incompleteBeta}.
 */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta function `I_x(a, b)` (Numerical Recipes `betai`). */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta =
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnBeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betacf(a, b, x)) / a;
  }
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Lanczos approximation of `ln(Γ(z))`. */
function gammaln(z: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/**
 * Two-tailed p-value for a Pearson correlation `r` computed from `n` points,
 * via the Student's-t distribution with `n - 2` degrees of freedom.
 */
function correlationPValue(r: number, n: number): number {
  const df = n - 2;
  if (df <= 0) return 1;
  // Perfect correlation: p-value collapses to 0.
  if (Math.abs(r) >= 1) return 0;
  const t2 = (r * r * df) / (1 - r * r);
  // betai(df/2, 1/2, df/(df + t^2)) gives the two-tailed tail probability.
  return incompleteBeta(df / 2, 0.5, df / (df + t2));
}

/**
 * A daily-aggregated signal: `dayIndex -> value`. Medication signals aggregate
 * the count of taken doses per day; symptom signals aggregate mean severity.
 */
type DailySignal = Map<number, number>;

/** Build per-medication-variable daily "taken-dose count" signals. */
function buildMedicationSignals(
  prnLogs: readonly PrnLog[],
  medEvents: readonly MedEvent[],
  startMs: number,
  nowMs: number,
): Map<string, DailySignal> {
  const signals = new Map<string, DailySignal>();

  const add = (variable: string, day: number) => {
    let series = signals.get(variable);
    if (!series) {
      series = new Map();
      signals.set(variable, series);
    }
    series.set(day, (series.get(day) ?? 0) + 1);
  };

  for (const log of prnLogs) {
    const day = inWindowDay(log.takenAt, startMs, nowMs);
    if (day !== null) {
      add(log.medicationId, day);
    }
  }
  for (const event of medEvents) {
    // Only doses actually taken contribute to the medication "taken" signal.
    if (event.takenAt === null) continue;
    const day = inWindowDay(medEventTimestamp(event), startMs, nowMs);
    if (day !== null) {
      add(event.medicationId, day);
    }
  }
  return signals;
}

/** Build per-symptom-variable daily mean-severity signals. */
function buildSymptomSignals(
  symptoms: readonly SymptomEntry[],
  startMs: number,
  nowMs: number,
): Map<string, DailySignal> {
  // Accumulate sum + count per day, then collapse to a mean.
  const sums = new Map<string, Map<number, { sum: number; count: number }>>();

  for (const entry of symptoms) {
    const day = inWindowDay(entry.op_timestamp, startMs, nowMs);
    if (day === null) continue;
    let series = sums.get(entry.symptomType);
    if (!series) {
      series = new Map();
      sums.set(entry.symptomType, series);
    }
    const cell = series.get(day) ?? { sum: 0, count: 0 };
    cell.sum += entry.severity;
    cell.count += 1;
    series.set(day, cell);
  }

  const signals = new Map<string, DailySignal>();
  for (const [variable, series] of sums) {
    const mean: DailySignal = new Map();
    for (const [day, { sum, count }] of series) {
      mean.set(day, sum / count);
    }
    signals.set(variable, mean);
  }
  return signals;
}

/**
 * Count distinct in-window tracking days and paired-observation days for the
 * gating decision (20.3).
 */
function gatingCounts(
  symptoms: readonly SymptomEntry[],
  prnLogs: readonly PrnLog[],
  medEvents: readonly MedEvent[],
  startMs: number,
  nowMs: number,
): { trackingDays: number; pairedObservations: number } {
  const symptomDays = new Set<number>();
  const medicationDays = new Set<number>();

  for (const entry of symptoms) {
    const day = inWindowDay(entry.op_timestamp, startMs, nowMs);
    if (day !== null) symptomDays.add(day);
  }
  for (const log of prnLogs) {
    const day = inWindowDay(log.takenAt, startMs, nowMs);
    if (day !== null) medicationDays.add(day);
  }
  for (const event of medEvents) {
    const day = inWindowDay(medEventTimestamp(event), startMs, nowMs);
    if (day !== null) medicationDays.add(day);
  }

  const allDays = new Set<number>([...symptomDays, ...medicationDays]);
  let paired = 0;
  for (const day of symptomDays) {
    if (medicationDays.has(day)) paired += 1;
  }

  return { trackingDays: allDays.size, pairedObservations: paired };
}

/**
 * Evaluate every (medication, symptom, lag) candidate and return the best
 * (lowest p-value) correlation per (medication, symptom) pair. Pairing a
 * medication value on day `d` with a symptom value on day `d + lag` models the
 * medication preceding the symptom by `lag` days (20.1).
 */
function bestCorrelationsPerPair(
  medicationSignals: Map<string, DailySignal>,
  symptomSignals: Map<string, DailySignal>,
): CorrelationResult[] {
  const best = new Map<string, CorrelationResult>();

  for (const [medVar, medSeries] of medicationSignals) {
    for (const [sympVar, sympSeries] of symptomSignals) {
      for (let lag = MIN_LAG_DAYS; lag <= MAX_LAG_DAYS; lag++) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const [day, medValue] of medSeries) {
          const sympValue = sympSeries.get(day + lag);
          if (sympValue !== undefined) {
            xs.push(medValue);
            ys.push(sympValue);
          }
        }
        if (xs.length < MIN_POINTS_PER_CANDIDATE) continue;

        const r = pearson(xs, ys);
        if (r === null) continue;

        const pValue = correlationPValue(r, xs.length);
        const key = `${medVar}\u0000${sympVar}`;
        const existing = best.get(key);
        if (existing === undefined || pValue < existing.pValue) {
          best.set(key, {
            medicationVariable: medVar,
            symptomVariable: sympVar,
            direction: r >= 0 ? 'positive' : 'negative',
            lagDays: lag,
            pValue,
          });
        }
      }
    }
  }

  return [...best.values()];
}

/** Deterministic ordering: ascending p-value, then a stable tiebreak (20.5). */
function compareCorrelations(a: CorrelationResult, b: CorrelationResult): number {
  if (a.pValue !== b.pValue) return a.pValue - b.pValue;
  if (a.medicationVariable !== b.medicationVariable) {
    return a.medicationVariable < b.medicationVariable ? -1 : 1;
  }
  if (a.symptomVariable !== b.symptomVariable) {
    return a.symptomVariable < b.symptomVariable ? -1 : 1;
  }
  return a.lagDays - b.lagDays;
}

/** Render a correlation as a plain-language insight card (20.2). */
function toCard(correlation: CorrelationResult): AIInsightCard {
  return {
    variables: [correlation.medicationVariable, correlation.symptomVariable],
    direction: correlation.direction,
    lagDays: correlation.lagDays,
  };
}

/**
 * Detect temporal correlations and render insight cards over the trailing 30
 * calendar days (20.1–20.6).
 *
 * @param source Injected, already-decrypted in-memory vault view. Never mutated.
 * @param clock  Injected clock anchoring the trailing-30-day window (defaults to
 *               the device wall clock).
 * @param options Optional significance threshold override.
 * @returns A single {@link CorrelationOutcome}. Performs NO network I/O; callers
 *          render the result (19.1, 19.2 carried forward).
 */
export function detectCorrelations(
  source: VaultDataSource,
  clock: Clock = systemClock,
  options: DetectCorrelationsOptions = {},
): CorrelationOutcome {
  const threshold = options.significanceThreshold ?? DEFAULT_SIGNIFICANCE_THRESHOLD;

  try {
    const now = clock.now();
    const nowMs = now.getTime();
    if (Number.isNaN(nowMs)) {
      throw new TypeError('clock returned an invalid date');
    }
    const startMs = windowStart(now);

    const symptoms = source.getSymptoms();
    const prnLogs = source.getPrnLogs();
    const medEvents = source.getMedEvents();

    // Gating (20.3): need ≥14 tracking days AND ≥10 paired observations.
    const { trackingDays, pairedObservations } = gatingCounts(
      symptoms,
      prnLogs,
      medEvents,
      startMs,
      nowMs,
    );
    if (trackingDays < MIN_TRACKING_DAYS || pairedObservations < MIN_PAIRED_OBSERVATIONS) {
      return {
        status: 'insufficient-data',
        message: INSUFFICIENT_HISTORY_MESSAGE,
        trackingDays,
        pairedObservations,
      };
    }

    const startedAt = Date.now();

    const medicationSignals = buildMedicationSignals(prnLogs, medEvents, startMs, nowMs);
    const symptomSignals = buildSymptomSignals(symptoms, startMs, nowMs);

    const candidates = bestCorrelationsPerPair(medicationSignals, symptomSignals);
    const significant = candidates
      .filter((c) => c.pValue <= threshold)
      .sort(compareCorrelations)
      .slice(0, MAX_INSIGHT_CARDS);

    const durationMs = Date.now() - startedAt;

    // Sufficient data but nothing significant (20.4).
    if (significant.length === 0) {
      return {
        status: 'no-significant-correlations',
        message: NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
        durationMs,
      };
    }

    return {
      status: 'ok',
      cards: significant.map(toCard),
      correlations: significant,
      durationMs,
    };
  } catch {
    // On any failure: transmit nothing, leave the vault unchanged (read-only),
    // and surface an error message (19.7 carried forward).
    return {
      status: 'error',
      message: ANALYSIS_FAILED_MESSAGE,
    };
  }
}
