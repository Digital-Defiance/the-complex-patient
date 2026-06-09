/**
 * @complex-patient/medications — PRN Quick Log and 24-hour safety threshold
 *
 * Implements the one-tap Quick Log flow for as-needed (PRN) medications and the
 * trailing-24-hour cumulative safety check against `PrnConfig.safetyLimit24h`
 * (Requirements 13.1, 13.2, 13.5, 13.6, 13.7, 13.8).
 *
 * Behavioral guarantees:
 * - Quick Log records the configured PRN dose for the medication (13.1, 13.5).
 * - Before recording, the engine computes the cumulative dose amount logged for
 *   that medication within the trailing 24 hours relative to the log time and
 *   adds the proposed dose (13.5, 13.6).
 * - If the resulting cumulative would remain at or below the safety limit, the
 *   dose is recorded (13.5).
 * - If the resulting cumulative would be strictly greater than the limit, the
 *   immediate log is blocked, the cumulative total is left unchanged, and an
 *   override-required signal is returned so the caller can show the override
 *   warning prompt (13.6).
 * - When the caller confirms the override, the dose is recorded and flagged as
 *   an acknowledged override (13.7).
 * - When the caller cancels/dismisses (i.e. never confirms the override), no
 *   dose is recorded and the cumulative total is unchanged (13.8). This is the
 *   natural result of an `override-required` outcome — nothing is persisted.
 *
 * The pure core (`computeTrailing24hCumulative`, `evaluatePrnQuickLog`) is
 * separated from the persistence-bound {@link PrnQuickLogEngine} so the safety
 * logic is deterministic and testable without a crypto/storage runtime
 * (property test 11.3, unit tests 11.4).
 */

import type { MedicationProfile, PrnConfig, PrnLog } from '@complex-patient/domain';
import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import { readMedicationPartition, writeMedicationPartition } from './gateway';
import type { Clock, IdFactory, MedicationVaultStore, VaultCrypto } from './types';

/** Milliseconds in the trailing window: 24 hours. */
const TRAILING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Sum of PRN dose amounts logged for `medicationId` whose `takenAt` falls
 * within the trailing 24-hour window ending at `nowMs` — i.e. in the closed
 * interval `[nowMs - 24h, nowMs]` (Requirements 13.5, 13.6).
 *
 * Soft-deleted logs (`deleted === true`) are excluded so a tombstoned entry
 * never counts toward the cumulative. Logs with an unparseable `takenAt` are
 * ignored.
 *
 * @param logs    All PRN logs in the partition (any medication).
 * @param medicationId The medication whose cumulative is being computed.
 * @param nowMs   The reference time (epoch ms) the window trails from.
 */
export function computeTrailing24hCumulative(
  logs: readonly PrnLog[],
  medicationId: string,
  nowMs: number,
): number {
  const cutoff = nowMs - TRAILING_WINDOW_MS;
  let total = 0;
  for (const log of logs) {
    if (log.deleted === true) continue;
    if (log.medicationId !== medicationId) continue;
    const takenMs = Date.parse(log.takenAt);
    if (Number.isNaN(takenMs)) continue;
    if (takenMs < cutoff || takenMs > nowMs) continue;
    total += log.amount;
  }
  return total;
}

/** Inputs to the pure {@link evaluatePrnQuickLog} decision. */
export interface PrnQuickLogEvaluationInput {
  /** Cumulative amount already logged in the trailing 24h window. */
  existingCumulative: number;
  /** The dose amount that would be added by this Quick Log. */
  doseAmount: number;
  /** The medication's 24-hour cumulative safety limit. */
  safetyLimit24h: number;
  /** Whether the caller has acknowledged an override of the safety warning. */
  overrideAcknowledged: boolean;
}

/** Outcome of the pure PRN Quick Log decision. */
export interface PrnQuickLogEvaluation {
  /** Cumulative before this log (unchanged input). */
  existingCumulative: number;
  /** What the cumulative would become if the dose is recorded. */
  projectedCumulative: number;
  /** True when the projected cumulative is at or below the safety limit. */
  withinLimit: boolean;
  /**
   * True when the log must be blocked: the projected cumulative exceeds the
   * limit and no override has been acknowledged (13.6).
   */
  blocked: boolean;
  /**
   * True when the dose should be recorded: either within the limit, or the
   * caller acknowledged the override (13.5, 13.7).
   */
  recorded: boolean;
  /**
   * True when the recorded dose must be flagged as an acknowledged override:
   * it exceeds the limit but was confirmed (13.7).
   */
  overrideFlag: boolean;
}

/**
 * Pure decision for a PRN Quick Log against the trailing-24h safety threshold
 * (Requirements 13.5, 13.6, 13.7). Contains no I/O so it can be exhaustively
 * property-tested (Property 14).
 *
 * Decision table (with projected = existing + dose):
 * - projected ≤ limit                          → recorded, not blocked, no override flag
 * - projected > limit AND not acknowledged      → blocked, not recorded (cumulative unchanged)
 * - projected > limit AND acknowledged          → recorded, flagged as override
 */
export function evaluatePrnQuickLog(
  input: PrnQuickLogEvaluationInput,
): PrnQuickLogEvaluation {
  const { existingCumulative, doseAmount, safetyLimit24h, overrideAcknowledged } = input;
  const projectedCumulative = existingCumulative + doseAmount;
  // Strictly-greater-than comparison: at-limit is allowed (13.5 "at or below").
  const withinLimit = projectedCumulative <= safetyLimit24h;
  const recorded = withinLimit || overrideAcknowledged;
  const blocked = !recorded;
  const overrideFlag = recorded && !withinLimit;
  return {
    existingCumulative,
    projectedCumulative,
    withinLimit,
    blocked,
    recorded,
    overrideFlag,
  };
}

/** Options for a Quick Log call. */
export interface PrnQuickLogOptions {
  /**
   * Set true to confirm an override of the safety warning. Leave false/omitted
   * for the initial one-tap attempt; a cancel/dismiss is simply never calling
   * again with this set (13.8).
   */
  overrideAcknowledged?: boolean;
}

/**
 * Result of a {@link PrnQuickLogEngine.quickLog} call.
 *
 * - `logged`: dose recorded within the safety limit (13.5).
 * - `logged-override`: dose recorded as an acknowledged override (13.7).
 * - `override-required`: blocked; cumulative unchanged; caller should show the
 *   override warning prompt (13.6). Confirming calls again with
 *   `overrideAcknowledged: true`; cancelling does nothing (13.8).
 */
export type PrnQuickLogResult =
  | { ok: true; outcome: 'logged'; log: PrnLog; cumulative24h: number; safetyLimit24h: number }
  | { ok: true; outcome: 'logged-override'; log: PrnLog; cumulative24h: number; safetyLimit24h: number }
  | {
      ok: true;
      outcome: 'override-required';
      /** Unchanged cumulative within the trailing 24h window (13.6, 13.8). */
      cumulative24h: number;
      /** What the cumulative would have become had the dose been recorded. */
      projectedCumulative: number;
      safetyLimit24h: number;
    }
  | { ok: false; error: 'NOT_FOUND'; message: string }
  | { ok: false; error: 'NOT_PRN'; message: string };

/** Dependencies injected into the {@link PrnQuickLogEngine}. */
export interface PrnQuickLogEngineDeps {
  store: MedicationVaultStore;
  crypto: VaultCrypto;
  kek: CryptoKeyRef;
  /** UUID factory for new PRN log records (defaults to `crypto.randomUUID`). */
  newId?: IdFactory;
  /** Operational-timestamp clock (defaults to `() => new Date().toISOString()`). */
  now?: Clock;
}

/**
 * Records PRN Quick Logs into the `medications` partition and enforces the
 * trailing-24h safety threshold (Requirement 13).
 */
export class PrnQuickLogEngine {
  private readonly store: MedicationVaultStore;
  private readonly crypto: VaultCrypto;
  private readonly kek: CryptoKeyRef;
  private readonly newId: IdFactory;
  private readonly now: Clock;

  constructor(deps: PrnQuickLogEngineDeps) {
    this.store = deps.store;
    this.crypto = deps.crypto;
    this.kek = deps.kek;
    this.newId = deps.newId ?? defaultIdFactory;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Cumulative PRN amount recorded for a medication within the trailing 24h
   * window ending at the current clock time. Useful for dashboard display
   * (Requirement 13.5/13.6 visualization).
   */
  async cumulative24h(medicationId: string): Promise<number> {
    const state = await readMedicationPartition(this.store, this.crypto, this.kek);
    const nowMs = Date.parse(this.now());
    return computeTrailing24hCumulative(state.prnLogs, medicationId, nowMs);
  }

  /**
   * One-tap Quick Log for a PRN medication (Requirements 13.1, 13.5–13.8).
   *
   * Records the configured PRN dose when the resulting trailing-24h cumulative
   * stays at or below the safety limit, or when an override is acknowledged.
   * Otherwise blocks the log and returns `override-required`, leaving the stored
   * PRN logs (and therefore the cumulative total) unchanged.
   */
  async quickLog(
    medicationId: string,
    options: PrnQuickLogOptions = {},
  ): Promise<PrnQuickLogResult> {
    const state = await readMedicationPartition(this.store, this.crypto, this.kek);

    const profile = state.records.find(
      (r) => r.id === medicationId && r.deleted !== true,
    );
    if (profile === undefined) {
      return { ok: false, error: 'NOT_FOUND', message: `medication not found: ${medicationId}` };
    }

    const prn = resolvePrnConfig(profile);
    if (prn === null) {
      return {
        ok: false,
        error: 'NOT_PRN',
        message: `medication is not configured as PRN: ${medicationId}`,
      };
    }

    const takenAt = this.now();
    const nowMs = Date.parse(takenAt);
    const existingCumulative = computeTrailing24hCumulative(
      state.prnLogs,
      medicationId,
      nowMs,
    );

    const evaluation = evaluatePrnQuickLog({
      existingCumulative,
      doseAmount: prn.doseAmount,
      safetyLimit24h: prn.safetyLimit24h,
      overrideAcknowledged: options.overrideAcknowledged === true,
    });

    // Blocked: leave the cumulative total unchanged and prompt for override
    // (13.6). A cancel/dismiss is the absence of a follow-up override call (13.8).
    if (evaluation.blocked) {
      return {
        ok: true,
        outcome: 'override-required',
        cumulative24h: existingCumulative,
        projectedCumulative: evaluation.projectedCumulative,
        safetyLimit24h: prn.safetyLimit24h,
      };
    }

    // Record the configured PRN dose (13.5), flagged as an override when it
    // exceeds the limit but was acknowledged (13.7).
    const log: PrnLog = {
      id: this.newId(),
      op_timestamp: takenAt,
      medicationId,
      amount: prn.doseAmount,
      takenAt,
      ...(evaluation.overrideFlag ? { override: true } : {}),
    };

    const nextLogs = [...state.prnLogs, log];
    await writeMedicationPartition(
      this.store,
      this.crypto,
      this.kek,
      state.records,
      state.syncVersion,
      nextLogs,
    );

    return {
      ok: true,
      outcome: evaluation.overrideFlag ? 'logged-override' : 'logged',
      log,
      cumulative24h: evaluation.projectedCumulative,
      safetyLimit24h: prn.safetyLimit24h,
    };
  }
}

/**
 * Resolve the effective PRN config for a profile. A medication is PRN when it
 * carries a `prn` config (and, per the domain model, a `prn` schedule). Returns
 * `null` when the medication is not configured as PRN (13.2).
 */
function resolvePrnConfig(profile: MedicationProfile): PrnConfig | null {
  if (profile.prn === undefined) return null;
  return profile.prn;
}

/**
 * Default UUID factory. Mirrors the engine's fallback so the Quick Log engine
 * never throws for lack of a global `crypto.randomUUID`.
 */
function defaultIdFactory(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
