import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MedicationProfile, SymptomEntry, PrnLog } from '@complex-patient/domain';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import {
  detectCorrelations,
  MAX_INSIGHT_CARDS,
  MIN_TRACKING_DAYS,
  MIN_PAIRED_OBSERVATIONS,
  INSUFFICIENT_HISTORY_MESSAGE,
} from './correlation';
import {
  buildPhysicianReport,
  generatePhysicianReport,
  createInMemoryReportDataSource,
  REPORT_WINDOW_DAYS,
  SEVERE_SYMPTOM_THRESHOLD,
  NO_DATA_AVAILABLE_MESSAGE,
  REPORT_SECTION_TITLES,
  type PhysicianReport,
  type PhysicianReportRenderer,
} from './report';
import { createInMemoryVaultDataSource } from './data-source';
import type { Clock } from './types';

/**
 * Consolidated unit suite for insights gating + report sections (task 13.5).
 *
 * These targeted, example-based cases fill the boundary/gap space NOT already
 * exercised by correlation.test.ts, report.test.ts, and pipeline.test.ts:
 *   - the 14-tracking-day and 10-paired-observation gating boundaries (20.3),
 *   - the ≤10 card cap when fewer than the cap are significant + ascending
 *     p-value ordering (20.4, 20.5),
 *   - the trailing-90-day severe-symptom count at the window/severity
 *     boundaries (21.4),
 *   - partially-populated reports keeping per-section empty markers (21.5),
 *   - and the privacy invariant that no raw/derived data leaves the sandbox:
 *     the engines never touch a network primitive and return plain, fully
 *     serializable in-memory objects (19.2).
 */

// Fixed "current device date" anchoring every trailing window.
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

function medication(
  overrides: Partial<MedicationProfile> & { id: string; drugName: string; active: boolean },
): MedicationProfile {
  return makeTestMedicationProfile({
    op_timestamp: NOW.toISOString(),
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'POTS',
    schedule: { kind: 'prn' },
    ...overrides,
  });
}

/**
 * Build `pairCount` distinct (medication, symptom) variables over `days` paired
 * days with a strong monotonic positive relationship, so each pair yields one
 * significant correlation.
 */
function buildSignificantPairs(opts: {
  pairCount: number;
  days: number;
}): { symptoms: SymptomEntry[]; prnLogs: PrnLog[] } {
  const symptoms: SymptomEntry[] = [];
  const prnLogs: PrnLog[] = [];
  for (let p = 0; p < opts.pairCount; p++) {
    for (let day = 0; day < opts.days; day++) {
      const ts = daysAgo(day);
      symptoms.push(
        symptom({
          id: `s-${p}-${day}`,
          severity: Math.min(10, day + 1),
          op_timestamp: ts,
          symptomType: `symp-${p}`,
        }),
      );
      const doses = day + 1;
      for (let k = 0; k < doses; k++) {
        prnLogs.push(prnLog({ id: `m-${p}-${day}-${k}`, takenAt: ts, medicationId: `med-${p}` }));
      }
    }
  }
  return { symptoms, prnLogs };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectCorrelations — gating boundaries (20.3)', () => {
  it('gates at 13 tracking days even when paired observations exceed the minimum', () => {
    // 13 distinct paired days: pairs (13) ≥ 10 but tracking days (13) < 14.
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];
    for (let day = 0; day < MIN_TRACKING_DAYS - 1; day++) {
      symptoms.push(symptom({ id: `s-${day}`, severity: (day % 9) + 1, op_timestamp: daysAgo(day) }));
      prnLogs.push(prnLog({ id: `p-${day}`, takenAt: daysAgo(day) }));
    }
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') return;
    expect(result.message).toBe(INSUFFICIENT_HISTORY_MESSAGE);
    expect(result.trackingDays).toBe(MIN_TRACKING_DAYS - 1);
    expect(result.pairedObservations).toBe(MIN_TRACKING_DAYS - 1);
  });

  it('does NOT gate at exactly 10 paired observations with 14 tracking days', () => {
    // 10 paired days + 4 symptom-only days = 14 tracking days, exactly 10 pairs.
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];
    for (let day = 0; day < MIN_PAIRED_OBSERVATIONS; day++) {
      symptoms.push(symptom({ id: `s-${day}`, severity: (day % 9) + 1, op_timestamp: daysAgo(day) }));
      prnLogs.push(prnLog({ id: `p-${day}`, takenAt: daysAgo(day) }));
    }
    for (let day = MIN_PAIRED_OBSERVATIONS; day < MIN_TRACKING_DAYS; day++) {
      symptoms.push(symptom({ id: `s-${day}`, severity: 5, op_timestamp: daysAgo(day) }));
    }
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    // Exactly at both thresholds: gating must NOT trigger.
    expect(result.status).not.toBe('insufficient-data');
  });

  it('gates at 9 paired observations even with abundant tracking days', () => {
    // 20 distinct symptom days (tracking ≥ 14) but only 9 carry a medication.
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];
    for (let day = 0; day < 20; day++) {
      symptoms.push(symptom({ id: `s-${day}`, severity: (day % 9) + 1, op_timestamp: daysAgo(day) }));
    }
    for (let day = 0; day < MIN_PAIRED_OBSERVATIONS - 1; day++) {
      prnLogs.push(prnLog({ id: `p-${day}`, takenAt: daysAgo(day) }));
    }
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') return;
    expect(result.trackingDays).toBe(20);
    expect(result.pairedObservations).toBe(MIN_PAIRED_OBSERVATIONS - 1);
  });
});

describe('detectCorrelations — card cap and ordering below the cap (20.4, 20.5)', () => {
  it('returns one ascending-p-value card per significant pair when under the cap', () => {
    const { symptoms, prnLogs } = buildSignificantPairs({ pairCount: 3, days: 20 });
    const source = createInMemoryVaultDataSource({ symptoms, prnLogs });

    const result = detectCorrelations(source, fixedClock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // The engine evaluates every medication×symptom combination, so 3 strongly
    // monotonic variables yield several significant cross-correlations — all
    // still under the 10-card cap, so no clamping occurs.
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards.length).toBeLessThan(MAX_INSIGHT_CARDS);
    expect(result.cards.length).toBe(result.correlations.length);

    // Non-decreasing p-values across the returned correlations.
    for (let i = 1; i < result.correlations.length; i++) {
      expect(result.correlations[i].pValue).toBeGreaterThanOrEqual(
        result.correlations[i - 1].pValue,
      );
    }
    // Each card mirrors its correlation's variables and direction (1:1).
    for (let i = 0; i < result.cards.length; i++) {
      const card = result.cards[i];
      const corr = result.correlations[i];
      expect(card.variables).toEqual([corr.medicationVariable, corr.symptomVariable]);
      expect(card.direction).toBe(corr.direction);
      expect(card.lagDays).toBe(corr.lagDays);
    }
  });
});

describe('buildPhysicianReport — severe-symptom 90-day boundaries (21.4)', () => {
  it('includes a severe symptom exactly at the 90-day window edge and excludes one just outside', () => {
    const source = createInMemoryReportDataSource({
      symptoms: [
        symptom({ id: 'edge-in', severity: 8, op_timestamp: daysAgo(REPORT_WINDOW_DAYS) }),
        symptom({ id: 'edge-out', severity: 9, op_timestamp: daysAgo(REPORT_WINDOW_DAYS + 1) }),
      ],
    });

    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.report.severeSymptomFrequency90d).toBe(1);
  });

  it('excludes future-dated severe symptoms and counts every severity at or above threshold', () => {
    const source = createInMemoryReportDataSource({
      symptoms: [
        symptom({ id: 'sev-7', severity: 7, op_timestamp: daysAgo(1) }),
        symptom({ id: 'sev-8', severity: 8, op_timestamp: daysAgo(2) }),
        symptom({ id: 'sev-9', severity: 9, op_timestamp: daysAgo(3) }),
        symptom({ id: 'sev-10', severity: 10, op_timestamp: daysAgo(4) }),
        // Just below the severe threshold: never counted.
        symptom({ id: 'sub', severity: SEVERE_SYMPTOM_THRESHOLD - 1, op_timestamp: daysAgo(5) }),
        // Severe but in the future (clock skew / bad data): excluded.
        symptom({
          id: 'future',
          severity: 10,
          op_timestamp: new Date(NOW.getTime() + 86_400_000).toISOString(),
        }),
      ],
    });

    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.report.severeSymptomFrequency90d).toBe(4);
  });
});

describe('buildPhysicianReport — per-section empty markers in a partial report (21.5)', () => {
  it('keeps empty markers on the severe-symptom and correlation sections while medications are populated', () => {
    const source = createInMemoryReportDataSource({
      medications: [medication({ id: 'm1', drugName: 'Atenolol', active: true })],
      // No symptoms and no medication signal → no severe count, no correlations.
    });

    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const meds = result.report.sections.find((s) => s.title === REPORT_SECTION_TITLES.medications)!;
    const severe = result.report.sections.find(
      (s) => s.title === REPORT_SECTION_TITLES.severeSymptoms,
    )!;
    const corr = result.report.sections.find(
      (s) => s.title === REPORT_SECTION_TITLES.correlations,
    )!;

    expect(meds.empty).toBe(false);
    expect(meds.lines[0]).toContain('Atenolol');

    expect(severe.empty).toBe(true);
    expect(severe.lines).toEqual([NO_DATA_AVAILABLE_MESSAGE]);
    expect(corr.empty).toBe(true);
    expect(corr.lines).toEqual([NO_DATA_AVAILABLE_MESSAGE]);
  });
});

describe('insights engines — no raw data leaves the sandbox (19.2)', () => {
  /** Returns a vault source with enough data to drive a full ok-status analysis. */
  function sufficientPairs() {
    const symptoms: SymptomEntry[] = [];
    const prnLogs: PrnLog[] = [];
    for (let day = 0; day < 20; day++) {
      const ts = daysAgo(day);
      symptoms.push(symptom({ id: `s-${day}`, severity: Math.min(10, day + 1), op_timestamp: ts }));
      const doses = day + 1;
      for (let k = 0; k < doses; k++) {
        prnLogs.push(prnLog({ id: `p-${day}-${k}`, takenAt: ts }));
      }
    }
    return { symptoms, prnLogs };
  }

  it('detectCorrelations never invokes fetch and returns a synchronous, fully serializable object', () => {
    const fetchSpy = vi.fn();
    const globalRef = globalThis as Record<string, unknown>;
    const originalFetch = globalRef.fetch;
    globalRef.fetch = fetchSpy;

    try {
      const source = createInMemoryVaultDataSource(sufficientPairs());
      const result = detectCorrelations(source, fixedClock);

      // Synchronous (no awaited network round-trip) and significant cards exist.
      expect(result).not.toBeInstanceOf(Promise);
      expect(result.status).toBe('ok');
      expect(fetchSpy).not.toHaveBeenCalled();
      // A plain in-memory object: it survives a JSON round-trip with no loss,
      // proving it carries no live handles, sockets, or class instances.
      expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    } finally {
      if (originalFetch === undefined) delete globalRef.fetch;
      else globalRef.fetch = originalFetch;
    }
  });

  it('generatePhysicianReport never invokes fetch and hands the renderer a plain report only', () => {
    const fetchSpy = vi.fn();
    const globalRef = globalThis as Record<string, unknown>;
    const originalFetch = globalRef.fetch;
    globalRef.fetch = fetchSpy;

    let rendered: PhysicianReport | undefined;
    const renderer: PhysicianReportRenderer<Uint8Array> = {
      render(report) {
        rendered = report;
        return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      },
    };

    try {
      const source = createInMemoryReportDataSource({
        medications: [medication({ id: 'm1', drugName: 'Atenolol', active: true })],
        symptoms: [symptom({ id: 's1', severity: 9, op_timestamp: daysAgo(3) })],
      });

      const result = generatePhysicianReport(source, renderer, fixedClock);

      expect(result).not.toBeInstanceOf(Promise);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(fetchSpy).not.toHaveBeenCalled();

      // The renderer only ever sees the in-memory report data model, and that
      // model is plain/serializable — no raw vault handles cross the seam.
      expect(rendered).toBe(result.report);
      expect(() => JSON.parse(JSON.stringify(result.report))).not.toThrow();
      expect(JSON.parse(JSON.stringify(result.report))).toEqual(result.report);
    } finally {
      if (originalFetch === undefined) delete globalRef.fetch;
      else globalRef.fetch = originalFetch;
    }
  });
});
