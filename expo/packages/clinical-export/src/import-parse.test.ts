/**
 * FHIR import parse tests.
 */

import { describe, expect, it } from 'vitest';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import { buildFhirBundle } from './fhir';
import { parseFhirBundleToSource, parsedImportRecordCount } from './import-parse';
import type { ClinicalExportSource } from './types';

const sampleSource: ClinicalExportSource = {
  medications: [
    makeTestMedicationProfile({
      id: 'med-1',
      op_timestamp: '2026-06-01T10:00:00.000Z',
      drugName: 'Ibuprofen',
      dosage: '200mg',
      prescribingPhysician: 'Dr. Smith',
      conditionTreated: 'Pain',
      schedule: { kind: 'prn' },
    }),
  ],
  prnLogs: [
    {
      id: 'prn-1',
      op_timestamp: '2026-06-02T08:00:00.000Z',
      medicationId: 'med-1',
      amount: 1,
      takenAt: '2026-06-02T08:00:00.000Z',
    },
  ],
  symptoms: [
    {
      id: 'sym-1',
      op_timestamp: '2026-06-02T09:00:00.000Z',
      symptomType: 'Headache',
      systemicLocation: 'Head',
      severity: 6,
      duration: { value: 2, unit: 'hours' },
      notes: 'Moderate',
      active: true,
    },
  ],
  conditions: [{ id: 'cond-1', op_timestamp: '2026-05-01T12:00:00.000Z', name: 'POTS' }],
  flares: [
    {
      id: 'flare-1',
      op_timestamp: '2026-06-03T12:00:00.000Z',
      symptomIds: ['sym-1', 'sym-2'],
      trigger: 'Heat exposure',
    },
  ],
  associations: [
    {
      id: 'assoc-1',
      op_timestamp: '2026-06-02T10:00:00.000Z',
      symptomId: 'sym-1',
      conditionIds: ['cond-1'],
      medicationIds: [],
    },
  ],
};

describe('parseFhirBundleToSource', () => {
  it('round-trips export bundles with domain extensions', () => {
    const bundle = buildFhirBundle(sampleSource, '2026-06-14T00:00:00.000Z');
    const parsed = parseFhirBundleToSource(bundle);

    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    expect(parsedImportRecordCount(parsed.source)).toBe(6);
    expect(parsed.source.medications[0]).toMatchObject(sampleSource.medications[0]);
    expect(parsed.source.prnLogs[0]).toMatchObject(sampleSource.prnLogs[0]);
    expect(parsed.source.symptoms[0]).toMatchObject(sampleSource.symptoms[0]);
    expect(parsed.source.conditions[0]).toMatchObject(sampleSource.conditions[0]);
    expect(parsed.source.flares[0]).toMatchObject(sampleSource.flares[0]);
    expect(parsed.source.associations[0]).toMatchObject(sampleSource.associations[0]);
    expect(parsed.warnings).toHaveLength(0);
  });
});
