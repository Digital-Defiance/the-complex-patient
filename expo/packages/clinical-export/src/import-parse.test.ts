/**
 * FHIR import parse tests.
 */

import { describe, expect, it } from 'vitest';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import { DOMAIN_EXTENSION_URL } from './constants';
import { buildFhirBundle } from './fhir';
import { parseFhirBundleToSource, parsedImportRecordCount } from './import-parse';
import type { ClinicalExportSource, FhirBundle } from './types';

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

  it('round-trips confirmed RxNorm identity fields', () => {
    const rxSource: ClinicalExportSource = {
      ...sampleSource,
      medications: [
        makeTestMedicationProfile({
          id: 'med-rx',
          op_timestamp: '2026-06-01T10:00:00.000Z',
          drugName: 'Advil',
          rxDisplayName: 'Ibuprofen',
          rxcui: '5640',
          ingredientRxcui: '5640',
          userConfirmedRxMatch: true,
          rxMatchConfidence: 0.91,
          rxnormDatasetVersion: 'seed-2026',
          dosage: '200mg',
          form: 'tablet',
          schedule: { kind: 'weekly', daysOfWeek: ['MON'], times: ['08:00'] },
        }),
      ],
    };

    const bundle = buildFhirBundle(rxSource, '2026-06-14T00:00:00.000Z');
    const parsed = parseFhirBundleToSource(bundle);

    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    expect(parsed.source.medications[0]).toMatchObject({
      id: 'med-rx',
      drugName: 'Advil',
      rxDisplayName: 'Ibuprofen',
      rxcui: '5640',
      ingredientRxcui: '5640',
      userConfirmedRxMatch: true,
      rxnormDatasetVersion: 'seed-2026',
    });
  });

  it('restores rxcui from RxNorm coding when domain extension lacks rx fields', () => {
    const rxSource: ClinicalExportSource = {
      ...sampleSource,
      medications: [
        makeTestMedicationProfile({
          id: 'med-coding-only',
          op_timestamp: '2026-06-01T10:00:00.000Z',
          drugName: 'Advil',
          rxDisplayName: 'Ibuprofen',
          rxcui: '5640',
          userConfirmedRxMatch: true,
          dosage: '200mg',
          form: 'tablet',
          schedule: { kind: 'weekly', daysOfWeek: ['MON'], times: ['08:00'] },
        }),
      ],
    };

    const bundle = buildFhirBundle(rxSource, '2026-06-14T00:00:00.000Z');
    const codingOnlyBundle = stripMedicationRxFromDomainExtension(bundle);

    const parsed = parseFhirBundleToSource(codingOnlyBundle);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    expect(parsed.source.medications[0]).toMatchObject({
      id: 'med-coding-only',
      drugName: 'Advil',
      rxcui: '5640',
      rxDisplayName: 'Ibuprofen',
      userConfirmedRxMatch: true,
    });
  });
});

function stripMedicationRxFromDomainExtension(bundle: FhirBundle): FhirBundle {
  return {
    ...bundle,
    entry: bundle.entry.map((entry) => {
      const resource = entry.resource;
      if (resource.resourceType !== 'MedicationStatement') {
        return entry;
      }

      const extensions = [...(resource.extension as Array<{ url?: string; valueString?: string }> ?? [])];
      const domainExt = extensions.find((ext) => ext.url === DOMAIN_EXTENSION_URL);
      if (domainExt?.valueString) {
        const domain = JSON.parse(domainExt.valueString) as Record<string, unknown>;
        delete domain.rxcui;
        delete domain.ingredientRxcui;
        delete domain.rxDisplayName;
        delete domain.rxMatchConfidence;
        delete domain.userConfirmedRxMatch;
        delete domain.rxnormDatasetVersion;
        delete domain.rxAnnotation;
        domainExt.valueString = JSON.stringify(domain);
      }

      return {
        ...entry,
        resource: {
          ...resource,
          extension: extensions,
        },
      };
    }),
  };
}
