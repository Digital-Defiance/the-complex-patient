/**
 * @complex-patient/insights — Sandboxed 30-day analysis pipeline
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7
 *
 * This module implements the privacy-preserving local analytics pipeline. It is
 * a **pure, in-memory computation**:
 *
 * - It reads already-decrypted data from an injected {@link VaultDataSource}
 *   and never touches the network. There is no import of any HTTP client,
 *   `fetch`, header, or query-parameter construction here, so no raw or derived
 *   analytics value can cross the network boundary (19.1, 19.2).
 * - It anchors the trailing 30-calendar-day window to an injected {@link Clock}
 *   and truncates older data before computing (19.3, 19.5).
 * - It computes the variance of symptom severity relative to medication
 *   adherence when at least one symptom and one medication entry fall in the
 *   window (19.4), completing well within the 3-second budget (19.3).
 * - It skips with an insufficient-data message when the window holds fewer than
 *   one symptom or fewer than one medication entry (19.6).
 * - It never mutates the {@link VaultDataSource}; on failure it returns an error
 *   result and transmits nothing, leaving the vault unchanged (19.7).
 */

import type { SymptomEntry, PrnLog } from '@complex-patient/domain';
import {
  ANALYSIS_FAILED_MESSAGE,
  ANALYSIS_WINDOW_DAYS,
  INSUFFICIENT_DATA_MESSAGE,
  type AnalysisResult,
  type Clock,
  type MedEvent,
  type VarianceAnalysis,
  type VaultDataSource,
} from './types';

/** Milliseconds in one calendar day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default clock backed by the device wall clock. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * The timestamp that anchors a medication event for windowing: prefer when the
 * dose was actually taken, falling back to when it was scheduled.
 */
function medEventTimestamp(event: MedEvent): string {
  return event.takenAt ?? event.scheduledAt;
}

/**
 * Inclusive lower bound of the trailing window: `now - 30 days`.
 * Records with a timestamp strictly before this instant are truncated (19.5).
 */
function windowStart(now: Date): number {
  return now.getTime() - ANALYSIS_WINDOW_DAYS * MS_PER_DAY;
}

/**
 * Whether an ISO 8601 timestamp falls within `[now - 30d, now]`.
 * Unparseable timestamps are treated as out-of-window (excluded) so malformed
 * data can never widen the analysis set.
 */
function isInWindow(isoTimestamp: string, startMs: number, nowMs: number): boolean {
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) {
    return false;
  }
  return t >= startMs && t <= nowMs;
}

/**
 * Population variance of a list of numbers. Returns 0 for a single value.
 */
function populationVariance(values: readonly number[], mean: number): number {
  if (values.length === 0) {
    return 0;
  }
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return sumSq / values.length;
}

/**
 * Compute the severity-vs-adherence variance over the already-truncated,
 * in-window inputs (19.4).
 *
 * Severity statistics come from the symptom entries. Adherence is the fraction
 * of medication signals that represent a dose actually taken: every PRN log is
 * a taken dose, and each {@link MedEvent} contributes a taken/scheduled signal.
 */
function computeVariance(
  symptoms: readonly SymptomEntry[],
  prnLogs: readonly PrnLog[],
  medEvents: readonly MedEvent[],
): VarianceAnalysis {
  const severities = symptoms.map((s) => s.severity);
  const severityMean =
    severities.reduce((acc, v) => acc + v, 0) / severities.length;
  const severityVariance = populationVariance(severities, severityMean);

  // Adherence: scheduled medication events provide taken/missed signal; PRN
  // logs are doses that were taken. When no scheduled events exist, observed
  // doses (PRN logs) are all "taken", so the rate is 1.
  const scheduledTaken = medEvents.filter((e) => e.takenAt !== null).length;
  const scheduledTotal = medEvents.length;
  const takenTotal = scheduledTaken + prnLogs.length;
  const observedTotal = scheduledTotal + prnLogs.length;
  const adherenceRate = observedTotal === 0 ? 1 : takenTotal / observedTotal;

  const medicationCount = prnLogs.length + medEvents.length;

  return {
    severityMean,
    severityVariance,
    adherenceRate,
    symptomCount: symptoms.length,
    medicationCount,
  };
}

/**
 * Run the sandboxed 30-day analysis.
 *
 * @param source Injected, already-decrypted in-memory vault view. Never mutated.
 * @param clock  Injected clock anchoring the trailing-30-day window (defaults to
 *               the device wall clock).
 * @returns A single {@link AnalysisResult} discriminated outcome. This function
 *          performs NO network I/O and returns only an in-memory object; callers
 *          are responsible for rendering it (19.1, 19.2).
 */
export function runAnalysis(
  source: VaultDataSource,
  clock: Clock = systemClock,
): AnalysisResult {
  try {
    const now = clock.now();
    const nowMs = now.getTime();
    if (Number.isNaN(nowMs)) {
      throw new TypeError('clock returned an invalid date');
    }
    const startMs = windowStart(now);

    // Read from the in-memory source and truncate to the trailing 30 days
    // (19.3, 19.5). Reads are non-mutating copies.
    const symptoms = source
      .getSymptoms()
      .filter((s) => isInWindow(s.op_timestamp, startMs, nowMs));
    const prnLogs = source
      .getPrnLogs()
      .filter((p) => isInWindow(p.takenAt, startMs, nowMs));
    const medEvents = source
      .getMedEvents()
      .filter((e) => isInWindow(medEventTimestamp(e), startMs, nowMs));

    const symptomCount = symptoms.length;
    const medicationCount = prnLogs.length + medEvents.length;

    // Insufficient-data gating: skip the variance computation (19.6).
    if (symptomCount < 1 || medicationCount < 1) {
      return {
        status: 'insufficient-data',
        message: INSUFFICIENT_DATA_MESSAGE,
        symptomCount,
        medicationCount,
      };
    }

    const startedAt = Date.now();
    const analysis = computeVariance(symptoms, prnLogs, medEvents);
    const durationMs = Date.now() - startedAt;

    return { status: 'ok', analysis, durationMs };
  } catch (cause) {
    // On any failure: transmit nothing, leave the vault unchanged (the source
    // is only ever read), and surface an error message (19.7).
    return {
      status: 'error',
      message: ANALYSIS_FAILED_MESSAGE,
    };
  }
}
