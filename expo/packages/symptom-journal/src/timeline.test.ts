/**
 * Unit tests for the condition timeline projection.
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5
 */

import { describe, it, expect } from 'vitest';
import type {
  Association,
  FlareUp,
  MedicationProfile,
  SymptomEntry,
} from '@complex-patient/domain';
import { buildConditionTimeline } from './index';

/* --------------------------- record factories ---------------------------- */

function symptom(id: string, op_timestamp: string): SymptomEntry {
  return {
    id,
    op_timestamp,
    symptomType: 'fatigue',
    systemicLocation: 'whole-body',
    severity: 5,
    duration: { value: 2, unit: 'hours' },
    notes: '',
    active: true,
  };
}

function medication(id: string, op_timestamp: string): MedicationProfile {
  return {
    id,
    op_timestamp,
    drugName: 'Drug ' + id,
    dosage: '10mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Who',
    conditionTreated: 'POTS',
    active: true,
    schedule: { kind: 'prn' },
  };
}

function flare(id: string, op_timestamp: string, symptomIds: string[]): FlareUp {
  return { id, op_timestamp, symptomIds, trigger: 'heat' };
}

function association(
  id: string,
  symptomId: string,
  conditionIds: string[],
  medicationIds: string[] = [],
): Association {
  return { id, op_timestamp: '2024-01-01T00:00:00Z', symptomId, conditionIds, medicationIds };
}

const ids = (t: { entries: { id: string }[] }): string[] => t.entries.map((e) => e.id);

/* --------------------------------- tests ---------------------------------- */

describe('buildConditionTimeline', () => {
  it('filters to only entries tagged to the condition, excluding untagged (18.1)', () => {
    const symptoms = [
      symptom('s-tagged', '2024-01-02T00:00:00Z'),
      symptom('s-untagged', '2024-01-03T00:00:00Z'),
    ];
    const meds = [medication('m-tagged', '2024-01-02T12:00:00Z'), medication('m-untagged', '2024-01-04T00:00:00Z')];
    const flares = [
      flare('f-tagged', '2024-01-05T00:00:00Z', ['s-tagged']),
      flare('f-untagged', '2024-01-06T00:00:00Z', ['s-untagged']),
    ];
    const assoc = [association('a1', 's-tagged', ['c1'], ['m-tagged'])];

    const timeline = buildConditionTimeline('c1', symptoms, meds, flares, assoc);

    expect(new Set(ids(timeline))).toEqual(new Set(['s-tagged', 'm-tagged', 'f-tagged']));
    expect(timeline.isEmpty).toBe(false);
  });

  it('orders entries by op_timestamp descending, most recent first (18.2)', () => {
    const symptoms = [
      symptom('s1', '2024-01-01T00:00:00Z'),
      symptom('s2', '2024-03-01T00:00:00Z'),
      symptom('s3', '2024-02-01T00:00:00Z'),
    ];
    const assoc = [
      association('a1', 's1', ['c1']),
      association('a2', 's2', ['c1']),
      association('a3', 's3', ['c1']),
    ];

    const timeline = buildConditionTimeline('c1', symptoms, [], [], assoc);

    expect(ids(timeline)).toEqual(['s2', 's3', 's1']);
  });

  it('breaks equal-timestamp ties by lexicographically greater id (18.3)', () => {
    const ts = '2024-01-01T00:00:00Z';
    const symptoms = [symptom('s-aaa', ts), symptom('s-ccc', ts), symptom('s-bbb', ts)];
    const assoc = [
      association('a1', 's-aaa', ['c1']),
      association('a2', 's-ccc', ['c1']),
      association('a3', 's-bbb', ['c1']),
    ];

    const timeline = buildConditionTimeline('c1', symptoms, [], [], assoc);

    expect(ids(timeline)).toEqual(['s-ccc', 's-bbb', 's-aaa']);
  });

  it('signals the empty-state when nothing is tagged to the condition (18.4)', () => {
    const symptoms = [symptom('s1', '2024-01-01T00:00:00Z')];
    const assoc = [association('a1', 's1', ['other-condition'])];

    const timeline = buildConditionTimeline('c1', symptoms, [], [], assoc);

    expect(timeline.entries).toEqual([]);
    expect(timeline.isEmpty).toBe(true);
  });

  it('returns a non-empty timeline (no empty-state) while at least one entry is tagged (18.5)', () => {
    const symptoms = [symptom('s1', '2024-01-01T00:00:00Z')];
    const assoc = [association('a1', 's1', ['c1'])];

    const timeline = buildConditionTimeline('c1', symptoms, [], [], assoc);

    expect(timeline.isEmpty).toBe(false);
    expect(ids(timeline)).toEqual(['s1']);
  });

  it('includes a flare-up when any of its symptoms is tagged to the condition (18.1)', () => {
    const symptoms = [symptom('s-tagged', '2024-01-01T00:00:00Z')];
    const flares = [flare('f1', '2024-01-02T00:00:00Z', ['s-untagged', 's-tagged'])];
    const assoc = [association('a1', 's-tagged', ['c1'])];

    const timeline = buildConditionTimeline('c1', symptoms, [], flares, assoc);

    expect(ids(timeline)).toEqual(expect.arrayContaining(['s-tagged', 'f1']));
  });

  it('is deterministic for identical inputs', () => {
    const symptoms = [symptom('s1', '2024-02-01T00:00:00Z'), symptom('s2', '2024-01-01T00:00:00Z')];
    const meds = [medication('m1', '2024-03-01T00:00:00Z')];
    const flares = [flare('f1', '2024-04-01T00:00:00Z', ['s1'])];
    const assoc = [association('a1', 's1', ['c1'], ['m1']), association('a2', 's2', ['c1'])];

    const first = buildConditionTimeline('c1', symptoms, meds, flares, assoc);
    const second = buildConditionTimeline('c1', symptoms, meds, flares, assoc);

    expect(ids(first)).toEqual(ids(second));
    expect(ids(first)).toEqual(['f1', 'm1', 's1', 's2']);
  });
});
