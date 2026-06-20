/**
 * Import preview unit tests.
 */

import { describe, expect, it } from 'vitest';
import { buildFhirBundle, createClinicalExport, previewClinicalImport } from './index';
import { buildImportPreview } from './import-preview';
import type { ClinicalExportSource } from './types';

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
  prnLogs: [],
  symptoms: [],
  conditions: [{ id: 'cond-1', op_timestamp: '2026-05-01T12:00:00.000Z', name: 'POTS' }],
  flares: [],
  associations: [],
};

describe('buildImportPreview', () => {
  it('summarizes resource counts and detects Complex Patient exports', () => {
    const bundle = buildFhirBundle(sampleSource, '2026-06-14T00:00:00.000Z');
    const result = buildImportPreview(bundle);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.preview.isComplexPatientExport).toBe(true);
    expect(result.preview.resourceCounts.Condition).toBe(1);
    expect(result.preview.resourceCounts.MedicationStatement).toBe(1);
    expect(result.preview.exportedAt).toBe('2026-06-14T00:00:00.000Z');
  });
});

describe('previewClinicalImport', () => {
  it('unpacks a zip and returns a preview summary', async () => {
    const exported = await createClinicalExport({
      source: sampleSource,
      zipPassword: 'round-trip-password',
      exportedAt: '2026-06-14T00:00:00.000Z',
    });

    expect(exported.status).toBe('ok');
    if (exported.status !== 'ok') return;

    const preview = await previewClinicalImport(exported.zipBytes, 'round-trip-password');
    expect(preview.status).toBe('ok');
    if (preview.status !== 'ok') return;

    expect(preview.preview.isComplexPatientExport).toBe(true);
    expect(preview.preview.totalResources).toBeGreaterThan(0);
  });

  it('fails with the wrong zip password', async () => {
    const exported = await createClinicalExport({
      source: sampleSource,
      zipPassword: 'correct-password',
    });

    expect(exported.status).toBe('ok');
    if (exported.status !== 'ok') return;

    const preview = await previewClinicalImport(exported.zipBytes, 'wrong-password');
    expect(preview.status).toBe('error');
  });
});
