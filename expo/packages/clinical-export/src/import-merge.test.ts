/**
 * Import merge tests.
 */

import { describe, expect, it } from 'vitest';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import { buildFhirBundle } from './fhir';
import { parseFhirBundleToSource } from './import-parse';
import { applyClinicalImportMerge, mergeRecordsById, prepareClinicalImportMerge } from './import-merge';
import type { ClinicalExportSource } from './types';

describe('mergeRecordsById', () => {
  it('adds new records and skips older duplicates', () => {
    const current = [{ id: 'a', op_timestamp: '2026-06-02T00:00:00.000Z' }];
    const incoming = [
      { id: 'b', op_timestamp: '2026-06-03T00:00:00.000Z' },
      { id: 'a', op_timestamp: '2026-06-01T00:00:00.000Z' },
    ];

    const merged = mergeRecordsById(current, incoming);
    expect(merged.records.map((record) => record.id).sort()).toEqual(['a', 'b']);
    expect(merged.stats).toEqual({ added: 1, updated: 0, skipped: 1 });
  });

  it('updates records when incoming op_timestamp is newer', () => {
    const current = [{ id: 'a', op_timestamp: '2026-06-01T00:00:00.000Z', name: 'Old' }];
    const incoming = [{ id: 'a', op_timestamp: '2026-06-03T00:00:00.000Z', name: 'New' }];

    const merged = mergeRecordsById(current, incoming);
    expect(merged.records[0]).toMatchObject({ name: 'New' });
    expect(merged.stats).toEqual({ added: 0, updated: 1, skipped: 0 });
  });
});

describe('prepareClinicalImportMerge', () => {
  it('prepares merged partitions from parsed import and current vault', () => {
    const exportSource: ClinicalExportSource = {
      medications: [
        makeTestMedicationProfile({
          id: 'med-1',
          op_timestamp: '2026-06-04T00:00:00.000Z',
          drugName: 'Imported',
          dosage: '5mg',
          prescribingPhysician: 'Dr. B',
          conditionTreated: 'Pain',
          schedule: { kind: 'prn' },
        }),
      ],
      prnLogs: [],
      symptoms: [],
      conditions: [],
      flares: [],
      associations: [],
    };

    const current: ClinicalExportSource = {
      medications: [
        makeTestMedicationProfile({
          id: 'med-local',
          op_timestamp: '2026-06-01T00:00:00.000Z',
          drugName: 'Local',
          dosage: '1mg',
          prescribingPhysician: 'Dr. A',
          conditionTreated: 'Pain',
          schedule: { kind: 'prn' },
        }),
      ],
      prnLogs: [],
      symptoms: [],
      conditions: [],
      flares: [],
      associations: [],
    };

    const bundle = buildFhirBundle(exportSource, '2026-06-14T00:00:00.000Z');
    const parsed = parseFhirBundleToSource(bundle);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    const prepared = prepareClinicalImportMerge(parsed.source, current);
    expect(prepared.totals.added).toBe(1);
    expect(prepared.partitions.medications.records.map((record) => record.id).sort()).toEqual([
      'med-1',
      'med-local',
    ]);
  });
});

describe('applyClinicalImportMerge', () => {
  it('commits merged partitions in vault order', async () => {
    const exportSource: ClinicalExportSource = {
      medications: [
        makeTestMedicationProfile({
          id: 'med-import',
          op_timestamp: '2026-06-04T00:00:00.000Z',
          drugName: 'Imported',
          dosage: '5mg',
          prescribingPhysician: 'Dr. B',
          conditionTreated: 'Pain',
          schedule: { kind: 'prn' },
        }),
      ],
      prnLogs: [],
      symptoms: [],
      conditions: [],
      flares: [],
      associations: [],
    };

    const current: ClinicalExportSource = {
      medications: [],
      prnLogs: [],
      symptoms: [],
      conditions: [],
      flares: [],
      associations: [],
    };

    const bundle = buildFhirBundle(exportSource, '2026-06-14T00:00:00.000Z');
    const commits: string[] = [];

    const result = await applyClinicalImportMerge(bundle, current, async (vaultType, records) => {
      commits.push(`${vaultType}:${records.length}`);
      return { ok: true };
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(commits).toEqual([
      'medications:1',
      'symptoms:0',
      'conditions:0',
      'flares:0',
      'associations:0',
      'locationTrail:0',
    ]);
    expect(result.totals.added).toBe(1);
  });

  it('stops when a commit fails', async () => {
    const bundle = buildFhirBundle(
      {
        medications: [
          makeTestMedicationProfile({
            id: 'med-import',
            op_timestamp: '2026-06-04T00:00:00.000Z',
            drugName: 'Imported',
            dosage: '5mg',
            prescribingPhysician: 'Dr. B',
            conditionTreated: 'Pain',
            schedule: { kind: 'prn' },
          }),
        ],
        prnLogs: [],
        symptoms: [],
        conditions: [],
        flares: [],
        associations: [],
      },
      '2026-06-14T00:00:00.000Z',
    );

    const result = await applyClinicalImportMerge(
      bundle,
      {
        medications: [],
        prnLogs: [],
        symptoms: [],
        conditions: [],
        flares: [],
        associations: [],
      },
      async (vaultType) => {
        if (vaultType === 'symptoms') {
          return { ok: false, message: 'Commit failed.' };
        }
        return { ok: true };
      },
    );

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toBe('Commit failed.');
  });
});
