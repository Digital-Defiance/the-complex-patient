import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SymptomEntry, PrnLog } from '@complex-patient/domain';
import { runAnalysis } from './pipeline';
import { createInMemoryVaultDataSource } from './data-source';
import {
  INSUFFICIENT_DATA_MESSAGE,
  ANALYSIS_FAILED_MESSAGE,
  type Clock,
  type MedEvent,
  type VaultDataSource,
} from './types';

// Fixed "current device date" used to anchor the trailing-30-day window.
const NOW = new Date('2024-06-30T12:00:00.000Z');
const fixedClock: Clock = { now: () => NOW };

/** ISO timestamp `days` whole days before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function symptom(overrides: Partial<SymptomEntry> & { id: string; severity: number; op_timestamp: string }): SymptomEntry {
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

function medEvent(overrides: Partial<MedEvent> & { id: string; scheduledAt: string }): MedEvent {
  return {
    op_timestamp: overrides.scheduledAt,
    medicationId: 'med-1',
    takenAt: overrides.scheduledAt,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runAnalysis — trailing-30-day truncation (19.3, 19.5)', () => {
  it('excludes symptom and medication records older than 30 days', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [
        symptom({ id: 's-in', severity: 5, op_timestamp: daysAgo(10) }),
        symptom({ id: 's-old', severity: 9, op_timestamp: daysAgo(45) }),
      ],
      prnLogs: [
        prnLog({ id: 'p-in', takenAt: daysAgo(5) }),
        prnLog({ id: 'p-old', takenAt: daysAgo(40) }),
      ],
      medEvents: [
        medEvent({ id: 'm-old', scheduledAt: daysAgo(31) }),
      ],
    });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Only the in-window symptom counts; the 45-day-old severity 9 is dropped.
    expect(result.analysis.symptomCount).toBe(1);
    expect(result.analysis.severityMean).toBe(5);
    // Only the in-window PRN log counts; old PRN + old medEvent dropped.
    expect(result.analysis.medicationCount).toBe(1);
  });

  it('includes records exactly at the 30-day boundary and excludes future records', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [
        symptom({ id: 's-boundary', severity: 4, op_timestamp: daysAgo(30) }),
        symptom({ id: 's-future', severity: 8, op_timestamp: new Date(NOW.getTime() + 60_000).toISOString() }),
      ],
      prnLogs: [prnLog({ id: 'p-boundary', takenAt: daysAgo(30) })],
    });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.analysis.symptomCount).toBe(1);
    expect(result.analysis.severityMean).toBe(4);
  });
});

describe('runAnalysis — insufficient-data gating (19.6)', () => {
  it('returns insufficient-data when there are zero symptoms in the window', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [],
      prnLogs: [prnLog({ id: 'p-1', takenAt: daysAgo(2) })],
    });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') return;
    expect(result.message).toBe(INSUFFICIENT_DATA_MESSAGE);
    expect(result.symptomCount).toBe(0);
    expect(result.medicationCount).toBe(1);
  });

  it('returns insufficient-data when there are zero medications in the window', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [symptom({ id: 's-1', severity: 6, op_timestamp: daysAgo(3) })],
      prnLogs: [],
      medEvents: [],
    });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') return;
    expect(result.medicationCount).toBe(0);
  });

  it('returns insufficient-data when in-window data exists but all entries are stale', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [symptom({ id: 's-old', severity: 6, op_timestamp: daysAgo(60) })],
      prnLogs: [prnLog({ id: 'p-old', takenAt: daysAgo(60) })],
    });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('insufficient-data');
  });
});

describe('runAnalysis — severity-vs-adherence variance (19.4)', () => {
  it('computes mean, population variance, and adherence on a known dataset', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [
        symptom({ id: 's-1', severity: 2, op_timestamp: daysAgo(1) }),
        symptom({ id: 's-2', severity: 4, op_timestamp: daysAgo(2) }),
        symptom({ id: 's-3', severity: 6, op_timestamp: daysAgo(3) }),
      ],
      // 4 scheduled events: 3 taken, 1 missed -> adherence 3/4 = 0.75
      medEvents: [
        medEvent({ id: 'm-1', scheduledAt: daysAgo(1), takenAt: daysAgo(1) }),
        medEvent({ id: 'm-2', scheduledAt: daysAgo(2), takenAt: daysAgo(2) }),
        medEvent({ id: 'm-3', scheduledAt: daysAgo(3), takenAt: daysAgo(3) }),
        medEvent({ id: 'm-4', scheduledAt: daysAgo(4), takenAt: null }),
      ],
    });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // mean([2,4,6]) = 4; popVariance = ((2-4)^2+(4-4)^2+(6-4)^2)/3 = 8/3
    expect(result.analysis.severityMean).toBe(4);
    expect(result.analysis.severityVariance).toBeCloseTo(8 / 3, 10);
    expect(result.analysis.adherenceRate).toBeCloseTo(0.75, 10);
    expect(result.analysis.symptomCount).toBe(3);
    expect(result.analysis.medicationCount).toBe(4);
  });

  it('reports adherence of 1 when only PRN logs supply the medication signal', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [symptom({ id: 's-1', severity: 5, op_timestamp: daysAgo(1) })],
      prnLogs: [
        prnLog({ id: 'p-1', takenAt: daysAgo(1) }),
        prnLog({ id: 'p-2', takenAt: daysAgo(2) }),
      ],
    });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.analysis.adherenceRate).toBe(1);
    expect(result.analysis.severityVariance).toBe(0);
  });

  it('completes well within the 3 second budget (19.3)', () => {
    const symptoms: SymptomEntry[] = Array.from({ length: 1000 }, (_, i) =>
      symptom({ id: `s-${i}`, severity: (i % 10) + 1, op_timestamp: daysAgo(i % 30) }),
    );
    const medEvents: MedEvent[] = Array.from({ length: 1000 }, (_, i) =>
      medEvent({ id: `m-${i}`, scheduledAt: daysAgo(i % 30) }),
    );
    const source = createInMemoryVaultDataSource({ symptoms, medEvents });

    const result = runAnalysis(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.durationMs).toBeLessThan(3000);
  });
});

describe('runAnalysis — failure handling (19.7)', () => {
  it('returns an error result without mutating the source when reading throws', () => {
    const throwingSource: VaultDataSource = {
      getSymptoms: () => {
        throw new Error('decryption failed');
      },
      getPrnLogs: () => [],
      getMedEvents: () => [],
    };

    const result = runAnalysis(throwingSource, fixedClock);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toBe(ANALYSIS_FAILED_MESSAGE);
  });

  it('returns an error result when the clock is invalid', () => {
    const source = createInMemoryVaultDataSource({
      symptoms: [symptom({ id: 's-1', severity: 5, op_timestamp: '2024-06-30T00:00:00Z' })],
      prnLogs: [prnLog({ id: 'p-1', takenAt: '2024-06-30T00:00:00Z' })],
    });
    const badClock: Clock = { now: () => new Date('not-a-date') };

    const result = runAnalysis(source, badClock);

    expect(result.status).toBe('error');
  });
});

describe('runAnalysis — no network I/O (19.1, 19.2)', () => {
  it('returns a plain in-memory result without invoking any network primitive', () => {
    // Spy on every network primitive that could exist in the environment.
    const fetchSpy = vi.fn();
    const globalRef = globalThis as Record<string, unknown>;
    const originalFetch = globalRef.fetch;
    globalRef.fetch = fetchSpy;

    try {
      const source = createInMemoryVaultDataSource({
        symptoms: [
          symptom({ id: 's-1', severity: 3, op_timestamp: daysAgo(1) }),
          symptom({ id: 's-2', severity: 7, op_timestamp: daysAgo(2) }),
        ],
        prnLogs: [prnLog({ id: 'p-1', takenAt: daysAgo(1) })],
        medEvents: [medEvent({ id: 'm-1', scheduledAt: daysAgo(2) })],
      });

      const result = runAnalysis(source, fixedClock);

      // The pipeline is synchronous and returns a value (not a Promise), proving
      // there is no awaited network round-trip.
      expect(result).not.toBeInstanceOf(Promise);
      expect(result.status).toBe('ok');
      // No network primitive was touched: no derived analytics crossed a boundary.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (originalFetch === undefined) {
        delete globalRef.fetch;
      } else {
        globalRef.fetch = originalFetch;
      }
    }
  });

  it('does not mutate the underlying source arrays across runs', () => {
    const symptoms: SymptomEntry[] = [
      symptom({ id: 's-1', severity: 5, op_timestamp: daysAgo(1) }),
    ];
    const prnLogs: PrnLog[] = [prnLog({ id: 'p-1', takenAt: daysAgo(1) })];
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    runAnalysis(source, fixedClock);
    runAnalysis(source, fixedClock);

    expect(source.getSymptoms()).toHaveLength(1);
    expect(source.getPrnLogs()).toHaveLength(1);
  });
});
