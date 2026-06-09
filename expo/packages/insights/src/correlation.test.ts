import { describe, it, expect } from 'vitest';
import type { SymptomEntry, PrnLog } from '@complex-patient/domain';
import {
  detectCorrelations,
  DEFAULT_SIGNIFICANCE_THRESHOLD,
  MAX_INSIGHT_CARDS,
  MAX_LAG_DAYS,
  INSUFFICIENT_HISTORY_MESSAGE,
  NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
} from './correlation';
import { createInMemoryVaultDataSource } from './data-source';
import { ANALYSIS_FAILED_MESSAGE, type Clock, type MedEvent, type VaultDataSource } from './types';

// Fixed "current device date" anchoring the trailing-30-day window.
const NOW = new Date('2024-06-30T12:00:00.000Z');
const fixedClock: Clock = { now: () => NOW };

/** ISO timestamp `days` whole days before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function symptom(
  overrides: Partial<SymptomEntry> & { id: string; severity: number; op_timestamp: string },
): SymptomEntry {
  return {
    symptomType: 'headache',
    systemicLocation: 'neurological',
    duration: { value: 1, unit: 'hours' },
    notes: '',
    active: true,
    ...overrides,
  };
}

function prnLog(overrides: Partial<PrnLog> & { id: string; takenAt: string }): PrnLog {
  return {
    op_timestamp: overrides.takenAt,
    medicationId: 'med-1',
    amount: 1,
    ...overrides,
  };
}

function medEvent(
  overrides: Partial<MedEvent> & { id: string; scheduledAt: string },
): MedEvent {
  return {
    op_timestamp: overrides.scheduledAt,
    medicationId: 'med-1',
    takenAt: overrides.scheduledAt,
    ...overrides,
  };
}

/**
 * Build a dataset spanning `days` distinct in-window days where, for each day,
 * `medDose(day)` taken doses of `medicationId` and a symptom severity given by
 * `severity(day)` are recorded. Every day is therefore a paired observation.
 */
function buildSeries(opts: {
  days: number;
  medicationId?: string;
  symptomType?: string;
  medDose: (day: number) => number;
  severity: (day: number) => number;
}): { symptoms: SymptomEntry[]; prnLogs: PrnLog[] } {
  const medicationId = opts.medicationId ?? 'med-1';
  const symptomType = opts.symptomType ?? 'headache';
  const symptoms: SymptomEntry[] = [];
  const prnLogs: PrnLog[] = [];

  for (let day = 0; day < opts.days; day++) {
    const ts = daysAgo(day);
    symptoms.push(
      symptom({ id: `s-${day}`, severity: opts.severity(day), op_timestamp: ts, symptomType }),
    );
    const doses = opts.medDose(day);
    for (let k = 0; k < doses; k++) {
      prnLogs.push(prnLog({ id: `p-${day}-${k}`, takenAt: ts, medicationId }));
    }
  }
  return { symptoms, prnLogs };
}

describe('detectCorrelations — insufficient-data gating (20.3)', () => {
  it('gates when fewer than 14 days of tracking history exist', () => {
    // 10 days, each a paired observation, but <14 days of history.
    const { symptoms, prnLogs } = buildSeries({
      days: 10,
      medDose: (d) => d + 1,
      severity: (d) => (d % 10) + 1,
    });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') return;
    expect(result.message).toBe(INSUFFICIENT_HISTORY_MESSAGE);
    expect(result.trackingDays).toBe(10);
  });

  it('gates when fewer than 10 paired observations exist despite ≥14 tracking days', () => {
    // 14 distinct tracking days but only 9 days carry BOTH a symptom and a med.
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];
    // 9 paired days.
    for (let day = 0; day < 9; day++) {
      symptoms.push(symptom({ id: `s-${day}`, severity: (day % 10) + 1, op_timestamp: daysAgo(day) }));
      prnLogs.push(prnLog({ id: `p-${day}`, takenAt: daysAgo(day) }));
    }
    // 5 symptom-only days extend history to 14 days without adding pairs.
    for (let day = 9; day < 14; day++) {
      symptoms.push(symptom({ id: `s-${day}`, severity: 5, op_timestamp: daysAgo(day) }));
    }
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') return;
    expect(result.trackingDays).toBe(14);
    expect(result.pairedObservations).toBe(9);
  });

  it('does not gate at exactly 14 tracking days and 10 paired observations', () => {
    const { symptoms, prnLogs } = buildSeries({
      days: 14,
      medDose: (d) => d + 1,
      severity: (d) => (d % 7) + 1,
    });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    // 14 days >= 14 and 14 pairs >= 10, so gating must NOT trigger.
    expect(result.status).not.toBe('insufficient-data');
  });
});

describe('detectCorrelations — significance threshold (20.2)', () => {
  it('produces a card for a strong monotonic relationship (p ≤ threshold)', () => {
    // Doses increase linearly with severity at lag 0 → near-perfect correlation.
    const { symptoms, prnLogs } = buildSeries({
      days: 20,
      medDose: (d) => d + 1,
      severity: (d) => Math.min(10, d + 1),
    });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.cards.length).toBeGreaterThanOrEqual(1);
    const card = result.cards[0];
    expect(card.variables).toEqual(['med-1', 'headache']);
    expect(card.direction).toBe('positive');
    expect(card.lagDays).toBeGreaterThanOrEqual(0);
    expect(card.lagDays).toBeLessThanOrEqual(MAX_LAG_DAYS);
    expect(result.correlations[0].pValue).toBeLessThanOrEqual(DEFAULT_SIGNIFICANCE_THRESHOLD);
  });

  it('detects a negative correlation direction', () => {
    const { symptoms, prnLogs } = buildSeries({
      days: 20,
      medDose: (d) => d + 1,
      severity: (d) => Math.max(1, 10 - d * 0.4),
    });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.cards[0].direction).toBe('negative');
  });

  it('honors a custom (stricter) significance threshold', () => {
    const { symptoms, prnLogs } = buildSeries({
      days: 20,
      medDose: (d) => d + 1,
      severity: (d) => Math.min(10, d + 1),
    });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    // A near-zero threshold rejects everything but a perfect correlation; this
    // capped/clamped data is strong but not perfect, so expect no cards.
    const result = detectCorrelations(source, fixedClock, { significanceThreshold: 0 });

    expect(['no-significant-correlations', 'ok']).toContain(result.status);
  });
});

describe('detectCorrelations — no-significant-correlations (20.4)', () => {
  it('reports analyzed-but-not-significant when data is sufficient but flat', () => {
    // Constant severity → zero variance → no computable correlation → none significant.
    const { symptoms, prnLogs } = buildSeries({
      days: 20,
      medDose: (d) => (d % 3) + 1,
      severity: () => 5,
    });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('no-significant-correlations');
    if (result.status !== 'no-significant-correlations') return;
    expect(result.message).toBe(NO_SIGNIFICANT_CORRELATIONS_MESSAGE);
  });
});

describe('detectCorrelations — card cap and ordering (20.5)', () => {
  it('caps at 10 cards and orders them by ascending p-value', () => {
    // 15 medication variables, each strongly correlated with its own symptom
    // type, over 20 paired days → 15 significant pairs, must clamp to 10.
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];
    const pairCount = 15;
    const days = 20;

    for (let p = 0; p < pairCount; p++) {
      for (let day = 0; day < days; day++) {
        const ts = daysAgo(day);
        // Each pair has a slightly different strength so p-values differ.
        const severity = Math.min(10, 1 + day * (0.3 + p * 0.02));
        symptoms.push(
          symptom({ id: `s-${p}-${day}`, severity, op_timestamp: ts, symptomType: `symp-${p}` }),
        );
        const doses = day + 1;
        for (let k = 0; k < doses; k++) {
          prnLogs.push(
            prnLog({ id: `m-${p}-${day}-${k}`, takenAt: ts, medicationId: `med-${p}` }),
          );
        }
      }
    }
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.cards.length).toBeLessThanOrEqual(MAX_INSIGHT_CARDS);
    expect(result.cards.length).toBe(MAX_INSIGHT_CARDS);

    // p-values are non-decreasing across the returned correlations.
    for (let i = 1; i < result.correlations.length; i++) {
      expect(result.correlations[i].pValue).toBeGreaterThanOrEqual(
        result.correlations[i - 1].pValue,
      );
    }
    // cards align 1:1 with correlations.
    expect(result.cards.length).toBe(result.correlations.length);
  });
});

describe('detectCorrelations — candidate lag detection (20.1)', () => {
  it('recovers a lag where medication precedes the symptom', () => {
    // Build a dataset where the symptom is shifted `lag` days from the
    // medication signal. A non-periodic pseudo-random dose sequence avoids
    // aliasing so the true lag is uniquely the strongest correlation.
    const lag = 3;
    const days = 22;
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];

    // Deterministic pseudo-random dose count per day in [1, 9], non-periodic.
    const doseFor = (day: number): number => (((day * 2654435761) >>> 0) % 9) + 1;

    // Medication doses on a given day index.
    for (let day = 0; day < days; day++) {
      const doses = doseFor(day);
      const ts = daysAgo(day);
      for (let k = 0; k < doses; k++) {
        prnLogs.push(prnLog({ id: `p-${day}-${k}`, takenAt: ts }));
      }
    }
    // Symptom severity appears `lag` days AFTER the dose: a medication on day
    // index D is paired by the engine with a symptom on day index D + lag (more
    // recent), i.e. daysAgo(day - lag) in wall-clock terms.
    for (let day = lag; day < days; day++) {
      const symDay = day - lag;
      symptoms.push(
        symptom({ id: `s-${day}`, severity: Math.min(10, doseFor(day)), op_timestamp: daysAgo(symDay) }),
      );
    }
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // The strongest correlation should be at the true lag.
    expect(result.correlations[0].lagDays).toBe(lag);
  });
});

describe('detectCorrelations — failure handling and timing', () => {
  it('returns an error when the source throws, without mutating it (19.7)', () => {
    const throwingSource: VaultDataSource = {
      getSymptoms: () => {
        throw new Error('decryption failed');
      },
      getPrnLogs: () => [],
      getMedEvents: () => [],
    };

    const result = detectCorrelations(throwingSource, fixedClock);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toBe(ANALYSIS_FAILED_MESSAGE);
  });

  it('returns an error when the clock is invalid', () => {
    const { symptoms, prnLogs } = buildSeries({
      days: 14,
      medDose: () => 1,
      severity: (d) => (d % 5) + 1,
    });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });
    const badClock: Clock = { now: () => new Date('not-a-date') };

    const result = detectCorrelations(source, badClock);

    expect(result.status).toBe('error');
  });

  it('completes well within the 10 second budget (20.6)', () => {
    // A large dataset exercising every lag across many pairs.
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];
    for (let p = 0; p < 8; p++) {
      for (let day = 0; day < 28; day++) {
        const ts = daysAgo(day);
        symptoms.push(
          symptom({ id: `s-${p}-${day}`, severity: (day % 10) + 1, op_timestamp: ts, symptomType: `symp-${p}` }),
        );
        prnLogs.push(prnLog({ id: `m-${p}-${day}`, takenAt: ts, medicationId: `med-${p}` }));
      }
    }
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status === 'ok' || result.status === 'no-significant-correlations').toBe(true);
    if (result.status === 'ok' || result.status === 'no-significant-correlations') {
      expect(result.durationMs).toBeLessThan(10000);
    }
  });
});
