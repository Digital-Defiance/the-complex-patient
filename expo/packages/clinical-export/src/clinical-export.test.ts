/**
 * Clinical export unit tests.
 */

import { describe, expect, it } from 'vitest';
import { BlobReader, TextWriter, ZipReader } from './zip-entry';
import {
  buildFhirBundle,
  createClinicalExport,
  EXPORT_JSON_FILENAME,
  assertNoVaultArtifacts,
  serializeFhirJson,
  type ClinicalExportSource,
} from './index';

const sampleSource: ClinicalExportSource = {
  medications: [
    {
      id: 'med-1',
      op_timestamp: '2026-06-01T10:00:00.000Z',
      drugName: 'Ibuprofen',
      dosage: '200mg',
      form: 'tablet',
      prescribingPhysician: 'Dr. Smith',
      conditionTreated: 'Pain',
      active: true,
      schedule: { kind: 'prn' },
    },
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
      symptomIds: ['sym-1'],
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

describe('buildFhirBundle', () => {
  it('builds a collection bundle with mapped resource types', () => {
    const bundle = buildFhirBundle(sampleSource, '2026-06-14T00:00:00.000Z');
    const types = bundle.entry.map((entry) => entry.resource.resourceType);

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(types).toContain('Patient');
    expect(types).toContain('MedicationStatement');
    expect(types).toContain('Condition');
    expect(types).toContain('Observation');
    expect(types).toContain('Encounter');
    expect(types).toContain('MedicationAdministration');
    expect(types).toContain('Provenance');
  });

  it('excludes soft-deleted records', () => {
    const bundle = buildFhirBundle(
      {
        ...sampleSource,
        conditions: [
          ...sampleSource.conditions,
          { id: 'cond-deleted', op_timestamp: '2026-01-01T00:00:00.000Z', name: 'Removed', deleted: true },
        ],
      },
      '2026-06-14T00:00:00.000Z',
    );

    const ids = bundle.entry.map((entry) => entry.resource.id);
    expect(ids).not.toContain('cond-deleted');
  });
});

describe('serializeFhirJson', () => {
  it('does not include vault encryption artifacts', () => {
    const json = serializeFhirJson(buildFhirBundle(sampleSource, '2026-06-14T00:00:00.000Z'));
    expect(() => assertNoVaultArtifacts(json)).not.toThrow();
  });
});

describe('createClinicalExport', () => {
  it('packs FHIR JSON into a password-protected zip', async () => {
    const result = await createClinicalExport({
      source: sampleSource,
      zipPassword: 'test-export-password',
      exportedAt: '2026-06-14T00:00:00.000Z',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const reader = new ZipReader(new BlobReader(new Blob([result.zipBytes])));
    const entries = await reader.getEntries();
    expect(entries.some((entry) => entry.filename === EXPORT_JSON_FILENAME)).toBe(true);

    const jsonEntry = entries.find((entry) => entry.filename === EXPORT_JSON_FILENAME);
    expect(jsonEntry).toBeDefined();
    if (!jsonEntry?.getData) return;

    const textWriter = new TextWriter();
    const extracted = await jsonEntry.getData(textWriter, { password: 'test-export-password' });
    expect(extracted).toContain('"resourceType": "Bundle"');
    await reader.close();
  });

  it('fails to decrypt with the wrong zip password', async () => {
    const result = await createClinicalExport({
      source: sampleSource,
      zipPassword: 'correct-password',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const reader = new ZipReader(new BlobReader(new Blob([result.zipBytes])));
    const entries = await reader.getEntries();
    const jsonEntry = entries.find((entry) => entry.filename === EXPORT_JSON_FILENAME);
    expect(jsonEntry?.getData).toBeDefined();
    if (!jsonEntry?.getData) return;

    const textWriter = new TextWriter();
    await expect(
      jsonEntry.getData(textWriter, { password: 'wrong-password' }),
    ).rejects.toThrow();
    await reader.close();
  });

  it('rejects empty zip password', async () => {
    const result = await createClinicalExport({ source: sampleSource, zipPassword: '   ' });
    expect(result.status).toBe('error');
  });
});
