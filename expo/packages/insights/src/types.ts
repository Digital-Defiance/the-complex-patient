/**
 * @complex-patient/insights — Type definitions
 *
 * Types for the sandboxed, on-device analytics pipeline (Requirement 19).
 *
 * Every type here describes purely in-memory, client-side data. Nothing in this
 * module is serialized to, or read from, a network-bound buffer, payload,
 * header, or query parameter (Requirements 19.1, 19.2).
 */

import type { SymptomEntry, PrnLog, VaultRecord } from '@complex-patient/domain';

/**
 * A medication adherence / administration event.
 *
 * Represents a single scheduled dose and whether (and when) it was actually
 * taken. This is the medication-side signal the analytics pipeline correlates
 * against symptom severity (19.4).
 *
 * Note: the design's "Insights Domain" references `MedEvent` as part of
 * {@link AnalysisInput}. It is defined here (rather than in `@complex-patient/domain`)
 * because it is an analytics-layer projection of medication scheduling, not a
 * stored vault partition of its own.
 *
 * - `scheduledAt`: ISO 8601 timestamp the dose was scheduled for.
 * - `takenAt`: ISO 8601 timestamp the dose was taken, or `null` when missed.
 */
export interface MedEvent extends VaultRecord {
  medicationId: string;
  scheduledAt: string;
  takenAt: string | null;
}

/**
 * The decrypted, in-memory inputs to a single analysis run.
 *
 * Per design "Insights Domain": symptoms are constrained to the trailing 30
 * calendar days (19.3, 19.5); medication signal is carried by PRN logs and
 * medication adherence events.
 */
export interface AnalysisInput {
  symptoms: SymptomEntry[];
  prnLogs: PrnLog[];
  medEvents: MedEvent[];
}

/**
 * Read-only, in-memory view over the decrypted Local_Vault contents the
 * analytics pipeline needs.
 *
 * The pipeline depends on this abstraction (rather than the encrypted vault or
 * any network client) so that:
 *   1. it can be supplied with already-decrypted data held only in client
 *      memory (19.1), and
 *   2. it is trivially testable with in-memory fixtures.
 *
 * All accessors are synchronous and side-effect free; the pipeline never
 * mutates the source, guaranteeing the vault is retained unchanged on failure
 * (19.7).
 */
export interface VaultDataSource {
  getSymptoms(): readonly SymptomEntry[];
  getPrnLogs(): readonly PrnLog[];
  getMedEvents(): readonly MedEvent[];
}

/**
 * Injectable clock used to anchor the trailing-30-day window to the current
 * device date (19.3). Injecting it keeps the window computation deterministic
 * under test.
 */
export interface Clock {
  now(): Date;
}

/**
 * The variance computation result for a sufficient dataset (19.4).
 *
 * - `severityMean`: arithmetic mean of in-window symptom severities.
 * - `severityVariance`: population variance of in-window symptom severities.
 * - `adherenceRate`: fraction of in-window medication adherence events that
 *   were actually taken (`takenAt != null`), in `[0, 1]`. PRN logs are counted
 *   as taken doses. When no medication events carry adherence information the
 *   rate is reported as `1` (all observed doses were taken).
 * - `symptomCount` / `medicationCount`: in-window entry counts after truncation.
 */
export interface VarianceAnalysis {
  severityMean: number;
  severityVariance: number;
  adherenceRate: number;
  symptomCount: number;
  medicationCount: number;
}

/**
 * Discriminated result of an analysis run.
 *
 * Exactly one outcome is produced:
 * - `ok`: sufficient data; variance computed (19.4).
 * - `insufficient-data`: <1 symptom or <1 medication entry in window (19.6).
 * - `error`: computation failed; vault left unchanged, nothing transmitted (19.7).
 */
export type AnalysisResult =
  | {
      status: 'ok';
      analysis: VarianceAnalysis;
      /** Wall-clock duration of the computation in milliseconds (19.3 budget). */
      durationMs: number;
    }
  | {
      status: 'insufficient-data';
      message: string;
      symptomCount: number;
      medicationCount: number;
    }
  | {
      status: 'error';
      message: string;
    };

/** User-facing message shown when there is not enough data to analyze (19.6). */
export const INSUFFICIENT_DATA_MESSAGE =
  'Not enough data to analyze. Log at least one symptom and one medication within the last 30 days.';

/** User-facing message shown when the computation fails (19.7). */
export const ANALYSIS_FAILED_MESSAGE =
  'Analysis could not be completed. Your data has not been changed.';

/** The trailing window size, in calendar days, read for analysis (19.3, 19.5). */
export const ANALYSIS_WINDOW_DAYS = 30;
