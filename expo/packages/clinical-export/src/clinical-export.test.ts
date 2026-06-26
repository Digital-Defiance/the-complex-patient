/**
 * Clinical export unit tests.
 */

import { describe, expect, it } from 'vitest';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import { BlobReader, TextWriter, ZipReader } from './zip-entry';
import {
  buildFhirBundle,
  createClinicalExport,
  EXPORT_JSON_FILENAME,
  EXPORT_MARKDOWN_FILENAME,
  assertNoVaultArtifacts,
  serializeFhirJson,
  buildClinicalSummaryMarkdown,
  type ClinicalExportSource,
  parseFhirBundleToSource,
} from './index';
import { DOMAIN_EXTENSION_URL } from './constants';

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

  it('includes RxNorm coding on user-confirmed medication matches', () => {
    const source: ClinicalExportSource = {
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
          rxnormDatasetVersion: 'seed-2026',
          dosage: '200mg',
          form: 'tablet',
          schedule: { kind: 'weekly', daysOfWeek: ['MON'], times: ['08:00'] },
        }),
      ],
    };

    const bundle = buildFhirBundle(source, '2026-06-14T00:00:00.000Z');
    const medEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'MedicationStatement',
    );
    expect(medEntry).toBeDefined();

    const concept = medEntry!.resource.medicationCodeableConcept as {
      text?: string;
      coding?: Array<{ system?: string; code?: string; display?: string }>;
    };
    expect(concept.text).toContain('Advil (naming database: Ibuprofen)');
    expect(concept.coding).toEqual([
      {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: '5640',
        display: 'Ibuprofen',
      },
    ]);

    const extensionPayload = JSON.parse(
      (
        medEntry!.resource.extension as Array<{ url: string; valueString?: string }>
      ).find((ext) => ext.url === DOMAIN_EXTENSION_URL)!.valueString!,
    );
    expect(extensionPayload.rxAnnotation).toContain('RxCUI 5640');
  });

  it('omits RxNorm coding when the match is not user-confirmed', () => {
    const source: ClinicalExportSource = {
      ...sampleSource,
      medications: [
        makeTestMedicationProfile({
          id: 'med-unconfirmed',
          drugName: 'Advil',
          rxcui: '5640',
          rxDisplayName: 'Ibuprofen',
          userConfirmedRxMatch: false,
        }),
      ],
    };

    const bundle = buildFhirBundle(source, '2026-06-14T00:00:00.000Z');
    const medEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'MedicationStatement',
    );
    const concept = medEntry!.resource.medicationCodeableConcept as {
      coding?: unknown;
      text?: string;
    };
    expect(concept.coding).toBeUndefined();
    expect(concept.text).toContain('Advil');
    expect(concept.text).not.toContain('naming database');
  });
});

describe('serializeFhirJson', () => {
  it('does not include vault encryption artifacts', () => {
    const json = serializeFhirJson(buildFhirBundle(sampleSource, '2026-06-14T00:00:00.000Z'));
    expect(() => assertNoVaultArtifacts(json)).not.toThrow();
  });
});

describe('buildClinicalSummaryMarkdown', () => {
  it('includes active medications and PRN logs from sample source', () => {
    const markdown = buildClinicalSummaryMarkdown(sampleSource, '2026-06-14T00:00:00.000Z');
    expect(markdown).toContain('Ibuprofen');
    expect(markdown).toContain('POTS');
    expect(markdown).toContain('Headache');
    expect(markdown).toContain('Heat exposure');
  });
});

describe('createClinicalExport', () => {
  it('packs FHIR JSON and Markdown summary into a password-protected zip', async () => {
    const result = await createClinicalExport({
      source: sampleSource,
      zipPassword: 'test-export-password',
      exportedAt: '2026-06-14T00:00:00.000Z',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.markdown).toContain('# Clinical Summary');
    expect(result.markdown).toContain('Ibuprofen');

    const reader = new ZipReader(new BlobReader(new Blob([result.zipBytes])));
    const entries = await reader.getEntries();
    expect(entries.some((entry) => entry.filename === EXPORT_JSON_FILENAME)).toBe(true);
    expect(entries.some((entry) => entry.filename === EXPORT_MARKDOWN_FILENAME)).toBe(true);

    const jsonEntry = entries.find((entry) => entry.filename === EXPORT_JSON_FILENAME);
    const markdownEntry = entries.find((entry) => entry.filename === EXPORT_MARKDOWN_FILENAME);
    expect(jsonEntry).toBeDefined();
    expect(markdownEntry).toBeDefined();
    if (!jsonEntry?.getData || !markdownEntry?.getData) return;

    const textWriter = new TextWriter();
    const extractedJson = await jsonEntry.getData(textWriter, { password: 'test-export-password' });
    expect(extractedJson).toContain('"resourceType":"Bundle"');

    const extractedMarkdown = await markdownEntry.getData(new TextWriter(), {
      password: 'test-export-password',
    });
    expect(extractedMarkdown).toContain('# Clinical Summary');
    expect(extractedMarkdown).toContain('Headache');
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

  it('reports staged progress while exporting', async () => {
    const stages: string[] = [];
    const result = await createClinicalExport({
      source: sampleSource,
      zipPassword: 'test-export-password',
      onProgress: (progress) => {
        stages.push(progress.stage);
      },
    });

    expect(result.status).toBe('ok');
    expect(stages).toContain('building-fhir');
    expect(stages).toContain('serializing');
    expect(stages).toContain('encrypting');
    expect(stages.at(-1)).toBe('encrypting');
  });

  it('preserves RxNorm coding through zip export and re-import', async () => {
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
          rxnormDatasetVersion: 'seed-2026',
          dosage: '200mg',
          form: 'tablet',
          schedule: { kind: 'weekly', daysOfWeek: ['MON'], times: ['08:00'] },
        }),
      ],
    };

    const result = await createClinicalExport({
      source: rxSource,
      zipPassword: 'test-export-password',
      exportedAt: '2026-06-14T00:00:00.000Z',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.markdown).toContain('Advil (naming database: Ibuprofen)');
    expect(result.markdown).toContain('RxCUI 5640');

    const reader = new ZipReader(new BlobReader(new Blob([result.zipBytes])));
    const entries = await reader.getEntries();
    const jsonEntry = entries.find((entry) => entry.filename === EXPORT_JSON_FILENAME);
    expect(jsonEntry?.getData).toBeDefined();
    if (!jsonEntry?.getData) return;

    const extractedJson = await jsonEntry.getData(new TextWriter(), {
      password: 'test-export-password',
    });
    expect(extractedJson).toContain('"system":"http://www.nlm.nih.gov/research/umls/rxnorm"');
    expect(extractedJson).toContain('"code":"5640"');

    const bundle = JSON.parse(extractedJson);
    const reimported = parseFhirBundleToSource(bundle);
    expect(reimported.status).toBe('ok');
    if (reimported.status !== 'ok') return;

    expect(reimported.source.medications[0]).toMatchObject({
      drugName: 'Advil',
      rxDisplayName: 'Ibuprofen',
      rxcui: '5640',
      userConfirmedRxMatch: true,
    });
    await reader.close();
  });
});
