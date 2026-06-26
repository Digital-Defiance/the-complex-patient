import { describe, expect, it } from 'vitest';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import { buildClinicalSummaryMarkdown } from './clinical-summary';
import type { ClinicalExportSource } from './types';

const visitPrepSource: ClinicalExportSource = {
  medications: [],
  prnLogs: [],
  conditions: [],
  associations: [],
  symptoms: [
    {
      id: 'b1ddf1b0-3490-404d-890b-23c7bd697cd5',
      op_timestamp: '2026-06-21T22:19:53.674Z',
      symptomType: 'Migraine',
      systemicLocation: 'Head',
      severity: 10,
      duration: { value: 3, unit: 'hours' },
      notes: "I'm Friggin' Dyin' 'Ere!",
      active: true,
    },
    {
      id: 'b323a80c-076e-4a3c-a964-e7d7798dec60',
      op_timestamp: '2026-06-21T22:21:32.936Z',
      symptomType: 'Joint Pain',
      systemicLocation: 'Everywhere',
      severity: 7,
      duration: { value: 3, unit: 'days' },
      notes: "I wanna' friggin' die!",
      active: true,
    },
  ],
  flares: [
    {
      id: '5f86a1b6-005c-47a1-8488-16874663998e',
      op_timestamp: '2026-06-21T22:21:45.937Z',
      symptomIds: [
        'b323a80c-076e-4a3c-a964-e7d7798dec60',
        'b1ddf1b0-3490-404d-890b-23c7bd697cd5',
      ],
      trigger: 'Weather!',
    },
  ],
};

describe('buildClinicalSummaryMarkdown', () => {
  it('produces a clinician-readable summary with symptoms, flares, and counts', () => {
    const markdown = buildClinicalSummaryMarkdown(
      visitPrepSource,
      '2026-06-21T22:26:27.442Z',
    );

    expect(markdown).toContain('# Clinical Summary');
    expect(markdown).toContain('## At a glance');
    expect(markdown).toContain('| Symptom entries | 2 |');
    expect(markdown).toContain('| Flare-ups | 1 |');
    expect(markdown).toContain('| Severe symptoms (7–10/10) | 2 |');
    expect(markdown).toContain('#### Migraine');
    expect(markdown).toContain('#### Joint Pain');
    expect(markdown).toContain('#### Flare-up');
    expect(markdown).toContain('**Symptoms involved:** Joint Pain, Migraine');
    expect(markdown).toContain('**Trigger (patient-reported):** Weather!');
    expect(markdown).toContain("I'm Friggin' Dyin' 'Ere!");
    expect(markdown).toContain('## For your clinician');
  });

  it('marks empty sections explicitly', () => {
    const markdown = buildClinicalSummaryMarkdown(
      {
        medications: [],
        prnLogs: [],
        symptoms: [],
        conditions: [],
        flares: [],
        associations: [],
      },
      '2026-06-21T00:00:00.000Z',
    );

    expect(markdown).toContain('_No conditions recorded._');
    expect(markdown).toContain('_No active medications recorded._');
    expect(markdown).toContain('_No symptoms or flare-ups recorded._');
  });

  it('includes confirmed generic names and RxNorm annotation in medication lines', () => {
    const markdown = buildClinicalSummaryMarkdown(
      {
        medications: [
          makeTestMedicationProfile({
            id: 'med-1',
            op_timestamp: '2026-06-21T12:00:00.000Z',
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
        prnLogs: [],
        symptoms: [],
        conditions: [],
        flares: [],
        associations: [],
      },
      '2026-06-21T12:00:00.000Z',
    );

    expect(markdown).toContain('**Advil (naming database: Ibuprofen)**');
    expect(markdown).toContain('RxCUI 5640');
    expect(markdown).toContain('dataset seed-2026');
  });
});
