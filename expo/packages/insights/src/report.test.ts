import { describe, it, expect } from 'vitest';
import type { MedicationProfile, SymptomEntry } from '@complex-patient/domain';
import {
  buildPhysicianReport,
  generatePhysicianReport,
  createInMemoryReportDataSource,
  REPORT_WINDOW_DAYS,
  SEVERE_SYMPTOM_THRESHOLD,
  NO_DATA_AVAILABLE_MESSAGE,
  REPORT_FAILED_MESSAGE,
  REPORT_SECTION_TITLES,
  type PhysicianReport,
  type PhysicianReportRenderer,
  type ReportDataSource,
} from './report';
import type { Clock } from './types';

// Fixed "current device date" anchoring the trailing-90-day window.
const NOW = new Date('2024-06-30T12:00:00.000Z');
const fixedClock: Clock = { now: () => NOW };

/** ISO timestamp `days` whole days before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function medication(
  overrides: Partial<MedicationProfile> & { id: string; drugName: string; active: boolean },
): MedicationProfile {
  return {
    op_timestamp: NOW.toISOString(),
    dosage: '10mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'POTS',
    schedule: { kind: 'prn' },
    ...overrides,
  };
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

/** A renderer that records the report it was given and returns a fixed payload. */
function recordingRenderer(): PhysicianReportRenderer<Uint8Array> & { last?: PhysicianReport } {
  const r: PhysicianReportRenderer<Uint8Array> & { last?: PhysicianReport } = {
    render(report) {
      r.last = report;
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    },
  };
  return r;
}

describe('buildPhysicianReport — active polypharmacy (21.1)', () => {
  it('includes only active medications, ordered alphabetically by drug name', () => {
    const source = createInMemoryReportDataSource({
      medications: [
        medication({ id: 'm1', drugName: 'Zoloft', active: true }),
        medication({ id: 'm2', drugName: 'Atenolol', active: true }),
        medication({ id: 'm3', drugName: 'Inactive Drug', active: false }),
      ],
    });

    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const names = result.report.activePolypharmacy.map((m) => m.drugName);
    expect(names).toEqual(['Atenolol', 'Zoloft']);

    const medSection = result.report.sections.find(
      (s) => s.title === REPORT_SECTION_TITLES.medications,
    )!;
    expect(medSection.empty).toBe(false);
    expect(medSection.lines).toHaveLength(2);
    expect(medSection.lines[0]).toContain('Atenolol');
  });
});

describe('buildPhysicianReport — trailing-90-day severe-symptom frequency (21.4)', () => {
  it('counts only severe-or-above occurrences within the trailing 90 days', () => {
    const source = createInMemoryReportDataSource({
      symptoms: [
        // In window, severe (>= threshold): counted.
        symptom({ id: 's1', severity: SEVERE_SYMPTOM_THRESHOLD, op_timestamp: daysAgo(1) }),
        symptom({ id: 's2', severity: 10, op_timestamp: daysAgo(89) }),
        // In window, below severe threshold: not counted.
        symptom({ id: 's3', severity: SEVERE_SYMPTOM_THRESHOLD - 1, op_timestamp: daysAgo(2) }),
        // Severe but outside the 90-day window: not counted.
        symptom({ id: 's4', severity: 9, op_timestamp: daysAgo(REPORT_WINDOW_DAYS + 5) }),
      ],
    });

    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.report.severeSymptomFrequency90d).toBe(2);
    expect(result.report.severeSymptomThreshold).toBe(SEVERE_SYMPTOM_THRESHOLD);
    expect(result.report.windowDays).toBe(REPORT_WINDOW_DAYS);

    const section = result.report.sections.find(
      (s) => s.title === REPORT_SECTION_TITLES.severeSymptoms,
    )!;
    expect(section.empty).toBe(false);
    expect(section.lines[0]).toContain('2');
  });

  it('counts a severity exactly at the severe threshold (boundary)', () => {
    const source = createInMemoryReportDataSource({
      symptoms: [
        symptom({ id: 's1', severity: SEVERE_SYMPTOM_THRESHOLD, op_timestamp: daysAgo(10) }),
      ],
    });
    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.report.severeSymptomFrequency90d).toBe(1);
  });
});

describe('buildPhysicianReport — correlation cards (21.1)', () => {
  it('includes significant correlation cards from the detector', () => {
    // Build 20 paired days with a perfectly monotonic medication/symptom signal
    // so the correlation is significant.
    const symptoms: SymptomEntry[] = [];
    const medications = [medication({ id: 'med-1', drugName: 'Atenolol', active: true })];
    const prnLogs = [];
    for (let day = 0; day < 20; day++) {
      const ts = daysAgo(day);
      symptoms.push(symptom({ id: `s-${day}`, severity: ((day % 10) + 1), op_timestamp: ts }));
      const doses = (day % 10) + 1;
      for (let k = 0; k < doses; k++) {
        prnLogs.push({ id: `p-${day}-${k}`, op_timestamp: ts, medicationId: 'med-1', amount: 1, takenAt: ts });
      }
    }

    const source = createInMemoryReportDataSource({ medications, symptoms, prnLogs });
    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.report.correlations.length).toBeGreaterThan(0);
    const section = result.report.sections.find(
      (s) => s.title === REPORT_SECTION_TITLES.correlations,
    )!;
    expect(section.empty).toBe(false);
  });
});

describe('buildPhysicianReport — explicit empty-section markers (21.5)', () => {
  it('marks every section empty with the no-data message when nothing exists', () => {
    const source = createInMemoryReportDataSource({});
    const result = buildPhysicianReport(source, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.report.activePolypharmacy).toEqual([]);
    expect(result.report.severeSymptomFrequency90d).toBe(0);
    expect(result.report.correlations).toEqual([]);

    expect(result.report.sections).toHaveLength(3);
    for (const section of result.report.sections) {
      expect(section.empty).toBe(true);
      expect(section.lines).toEqual([NO_DATA_AVAILABLE_MESSAGE]);
    }
  });
});

describe('generatePhysicianReport — on-device rendering & failure handling (21.2, 21.3, 21.6)', () => {
  it('compiles within budget and renders a document on-device', () => {
    const source = createInMemoryReportDataSource({
      medications: [medication({ id: 'm1', drugName: 'Atenolol', active: true })],
    });
    const renderer = recordingRenderer();

    const result = generatePhysicianReport(source, renderer, fixedClock);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.document).toBeInstanceOf(Uint8Array);
    expect(renderer.last).toBe(result.report);
    expect(result.durationMs).toBeLessThan(10_000);
  });

  it('returns an error and leaves the source unchanged when the renderer fails', () => {
    const medications = [medication({ id: 'm1', drugName: 'Atenolol', active: true })];
    const snapshot = JSON.stringify(medications);
    const source: ReportDataSource = createInMemoryReportDataSource({ medications });

    const throwingRenderer: PhysicianReportRenderer = {
      render() {
        throw new Error('PDF engine unavailable');
      },
    };

    const result = generatePhysicianReport(source, throwingRenderer, fixedClock);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toBe(REPORT_FAILED_MESSAGE);

    // Vault data source is read-only and unchanged.
    expect(JSON.stringify(source.getMedications())).toBe(snapshot);
  });

  it('returns an error when the clock is invalid (compilation failure)', () => {
    const source = createInMemoryReportDataSource({});
    const badClock: Clock = { now: () => new Date(NaN) };
    const renderer = recordingRenderer();

    const result = generatePhysicianReport(source, renderer, badClock);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toBe(REPORT_FAILED_MESSAGE);
    // Renderer was never invoked because compilation failed first.
    expect(renderer.last).toBeUndefined();
  });
});
