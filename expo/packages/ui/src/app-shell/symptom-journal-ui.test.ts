import { describe, expect, it } from 'vitest';
import type { FlareUp, SymptomEntry } from '@complex-patient/domain';
import {
  buildJournalTimeline,
  buildSeverityTrend,
  groupJournalByDay,
  mergeSymptomRecords,
  resolveSymptomTypeMatch,
  suggestSymptomTypes,
  symptomTypeKey,
} from './symptom-journal-ui';

function symptom(id: string, type: string): SymptomEntry {
  return {
    id,
    op_timestamp: '2024-01-01T00:00:00Z',
    symptomType: type,
    systemicLocation: 'Head',
    severity: 5,
    duration: { value: 1, unit: 'hours' },
    notes: '',
    active: true,
  };
}

describe('symptom-journal-ui', () => {
  it('matches symptom types case-insensitively', () => {
    const existing = [symptom('1', 'Headache')];
    expect(resolveSymptomTypeMatch(existing, 'headache')).toBe('Headache');
    expect(symptomTypeKey(' Headache ')).toBe('headache');
  });

  it('suggests existing symptom types while typing', () => {
    const existing = [symptom('1', 'Headache'), symptom('2', 'Joint pain')];
    expect(suggestSymptomTypes(existing, 'head')).toEqual(['Headache']);
  });

  it('merges journal writes without dropping existing records', () => {
    const current = [symptom('a', 'Headache')];
    const next = [symptom('b', 'Fatigue')];
    const merged = mergeSymptomRecords(current, next);
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('builds a combined symptom and flare timeline newest first', () => {
    const symptoms = [
      { ...symptom('s1', 'Headache'), op_timestamp: '2024-06-10T10:00:00Z' },
      { ...symptom('s2', 'Fatigue'), op_timestamp: '2024-06-12T09:00:00Z' },
    ];
    const flares: FlareUp[] = [
      {
        id: 'f1',
        op_timestamp: '2024-06-11T15:00:00Z',
        symptomIds: ['s1', 's2'],
        trigger: 'Weather change',
      },
    ];

    const timeline = buildJournalTimeline(symptoms, flares);
    expect(timeline.map((entry) => entry.id)).toEqual(['s2', 'f1', 's1']);
    expect(timeline[1]).toMatchObject({
      kind: 'flare',
      symptomLabels: ['Headache', 'Fatigue'],
    });
  });

  it('groups journal entries by calendar day', () => {
    const timeline = buildJournalTimeline(
      [{ ...symptom('s1', 'Headache'), op_timestamp: '2024-06-10T10:00:00Z' }],
      [{ id: 'f1', op_timestamp: '2024-06-10T18:00:00Z', symptomIds: ['s1', 's2'], trigger: '' }],
    );
    const groups = groupJournalByDay(timeline);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
  });

  it('builds a trailing severity trend with flare markers', () => {
    const timeline = buildJournalTimeline(
      [
        { ...symptom('s1', 'Headache'), op_timestamp: '2024-06-10T10:00:00Z', severity: 7 },
        { ...symptom('s2', 'Fatigue'), op_timestamp: '2024-06-12T09:00:00Z', severity: 4 },
      ],
      [{ id: 'f1', op_timestamp: '2024-06-11T15:00:00Z', symptomIds: ['s1', 's2'], trigger: '' }],
    );

    const trend = buildSeverityTrend(timeline, 14, new Date('2024-06-12T12:00:00Z'));
    const june10 = trend.find((day) => day.day === '2024-06-10');
    const june11 = trend.find((day) => day.day === '2024-06-11');
    const june12 = trend.find((day) => day.day === '2024-06-12');

    expect(june10?.maxSeverity).toBe(7);
    expect(june11?.flareCount).toBe(1);
    expect(june12?.maxSeverity).toBe(4);
  });
});
