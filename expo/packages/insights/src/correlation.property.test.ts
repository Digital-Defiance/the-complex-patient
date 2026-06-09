/**
 * Property-based test for Insights correlation gating (Task 13.4).
 *
 * Property 17: Insights gating is mutually exclusive and threshold-correct
 *   For any trailing-30-day dataset the engine produces exactly ONE outcome:
 *     - insufficient-data  iff trackingDays < 14 OR pairedObservations < 10
 *     - no-significant-correlations  when sufficient but no correlation is
 *       at/below the significance threshold
 *     - ok  otherwise: one card per significant correlation, at most 10,
 *       ordered by ascending (non-decreasing) p-value, every card's p-value
 *       at/below the threshold
 *   The three data-bearing outcomes are mutually exclusive.
 *
 * Validates: Requirements 19.6, 20.3, 20.4, 20.5
 *
 * Uses @fast-check/vitest for property-based testing integration. Each test
 * case is a random trailing-30-day dataset: every one of the 30 in-window days
 * independently may carry a symptom record, some PRN doses, and/or a scheduled
 * medication event, at varied volume so all three gating branches are
 * exercised. The expected tracking-day and paired-observation counts are
 * derived directly from the day model and compared against the engine's
 * decision. A fixed injected Clock anchors the window deterministically.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type { SymptomEntry, PrnLog } from '@complex-patient/domain';
import {
  detectCorrelations,
  DEFAULT_SIGNIFICANCE_THRESHOLD,
  MAX_INSIGHT_CARDS,
  MIN_LAG_DAYS,
  MAX_LAG_DAYS,
  MIN_TRACKING_DAYS,
  MIN_PAIRED_OBSERVATIONS,
} from './correlation';
import { createInMemoryVaultDataSource } from './data-source';
import type { Clock, MedEvent } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Fixed "current device date" anchoring the trailing-30-day window.
const NOW = new Date('2024-06-30T12:00:00.000Z');
const fixedClock: Clock = { now: () => NOW };

/** ISO timestamp `days` whole days before NOW (always inside the 30-day window). */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

/**
 * The per-day contribution to a generated dataset. Each of the 30 in-window
 * days is independently described by one of these.
 */
interface DaySpec {
  /** Symptom severity 1–10 when a symptom is recorded that day, else null. */
  severity: number | null;
  /** Number of PRN doses recorded that day (0 means no PRN logs). */
  prnDoses: number;
  /** A scheduled medication event that day, or null. `taken` toggles takenAt. */
  medEvent: { taken: boolean } | null;
}

// ---------------------------------------------------------------------------
// Generators — a fixed 30-element array, one DaySpec per distinct in-window day,
// with varied volume so insufficient-data / no-significant / ok all occur.
// ---------------------------------------------------------------------------

const daySpecArb: fc.Arbitrary<DaySpec> = fc.record({
  severity: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  prnDoses: fc.integer({ min: 0, max: 4 }),
  medEvent: fc.option(fc.record({ taken: fc.boolean() }), { nil: null }),
});

/** Exactly 30 days (indices 0..29), each mapped to a distinct in-window date. */
const datasetArb: fc.Arbitrary<DaySpec[]> = fc.array(daySpecArb, {
  minLength: 30,
  maxLength: 30,
});

interface BuiltDataset {
  symptoms: SymptomEntry[];
  prnLogs: PrnLog[];
  medEvents: MedEvent[];
  expectedTrackingDays: number;
  expectedPairedObservations: number;
}

/** Materialize the day model into vault records and the expected gating counts. */
function buildDataset(days: DaySpec[]): BuiltDataset {
  const symptoms: SymptomEntry[] = [];
  const prnLogs: PrnLog[] = [];
  const medEvents: MedEvent[] = [];

  let expectedTrackingDays = 0;
  let expectedPairedObservations = 0;

  days.forEach((spec, dayIndex) => {
    const ts = daysAgo(dayIndex);
    const hasSymptom = spec.severity !== null;
    // A day counts as a "medication day" if it carries a PRN dose OR a
    // scheduled medication event (gating anchors a med event by takenAt ??
    // scheduledAt, so an untaken scheduled event still marks the day).
    const hasMed = spec.prnDoses > 0 || spec.medEvent !== null;

    if (hasSymptom) {
      symptoms.push({
        id: `s-${dayIndex}`,
        op_timestamp: ts,
        symptomType: 'headache',
        systemicLocation: 'neurological',
        severity: spec.severity as number,
        duration: { value: 1, unit: 'hours' },
        notes: '',
        active: true,
      });
    }

    for (let k = 0; k < spec.prnDoses; k++) {
      prnLogs.push({
        id: `p-${dayIndex}-${k}`,
        op_timestamp: ts,
        medicationId: 'med-1',
        amount: 1,
        takenAt: ts,
      });
    }

    if (spec.medEvent !== null) {
      medEvents.push({
        id: `m-${dayIndex}`,
        op_timestamp: ts,
        medicationId: 'med-1',
        scheduledAt: ts,
        takenAt: spec.medEvent.taken ? ts : null,
      });
    }

    if (hasSymptom || hasMed) expectedTrackingDays += 1;
    if (hasSymptom && hasMed) expectedPairedObservations += 1;
  });

  return {
    symptoms,
    prnLogs,
    medEvents,
    expectedTrackingDays,
    expectedPairedObservations,
  };
}

describe('Property 17: Insights gating is mutually exclusive and threshold-correct (19.6, 20.3, 20.4, 20.5)', () => {
  it.prop([datasetArb])(
    'produces exactly one threshold-correct outcome for any trailing-30-day dataset',
    (days) => {
      const built = buildDataset(days);
      const source = createInMemoryVaultDataSource({
        symptoms: built.symptoms,
        prnLogs: built.prnLogs,
        medEvents: built.medEvents,
      });

      const result = detectCorrelations(source, fixedClock);

      // Well-formed in-memory input must never hit the error path.
      expect(result.status).not.toBe('error');

      const expectedInsufficient =
        built.expectedTrackingDays < MIN_TRACKING_DAYS ||
        built.expectedPairedObservations < MIN_PAIRED_OBSERVATIONS;

      // Threshold-correctness of the gate: insufficient-data iff under either
      // threshold (20.3 / 19.6).
      expect(result.status === 'insufficient-data').toBe(expectedInsufficient);

      // Mutual exclusivity: exactly one of the three data-bearing outcomes.
      const matched =
        Number(result.status === 'insufficient-data') +
        Number(result.status === 'no-significant-correlations') +
        Number(result.status === 'ok');
      expect(matched).toBe(1);

      if (result.status === 'insufficient-data') {
        // The reported counts mirror the dataset exactly.
        expect(result.trackingDays).toBe(built.expectedTrackingDays);
        expect(result.pairedObservations).toBe(built.expectedPairedObservations);
        return;
      }

      // From here, the dataset is sufficient (both thresholds met).
      expect(expectedInsufficient).toBe(false);

      if (result.status === 'no-significant-correlations') {
        // Sufficient data but nothing significant — no cards exist (20.4).
        return;
      }

      // status === 'ok' (20.5): at least one and at most MAX_INSIGHT_CARDS cards.
      expect(result.cards.length).toBeGreaterThanOrEqual(1);
      expect(result.cards.length).toBeLessThanOrEqual(MAX_INSIGHT_CARDS);
      // Cards align 1:1 with the underlying correlations.
      expect(result.cards.length).toBe(result.correlations.length);

      for (let i = 0; i < result.correlations.length; i++) {
        const c = result.correlations[i];
        // Every returned correlation is at/below the significance threshold.
        expect(c.pValue).toBeLessThanOrEqual(DEFAULT_SIGNIFICANCE_THRESHOLD);
        // Lag stays within the candidate range (20.1).
        expect(c.lagDays).toBeGreaterThanOrEqual(MIN_LAG_DAYS);
        expect(c.lagDays).toBeLessThanOrEqual(MAX_LAG_DAYS);
        // p-values are non-decreasing (ascending order).
        if (i > 0) {
          expect(c.pValue).toBeGreaterThanOrEqual(result.correlations[i - 1].pValue);
        }
      }
    },
  );
});
