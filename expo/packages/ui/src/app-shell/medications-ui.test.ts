import { describe, expect, it } from 'vitest';
import type { MedicationProfile } from '@complex-patient/domain';
import { makeMedicationProfile } from '@complex-patient/medications';
import {
  suggestConditionsTreated,
  suggestPrescribingPhysicians,
  buildPrnConfigFromDraft,
  emptyRegimenDraft,
} from './medications-ui';

function med(overrides: Partial<MedicationProfile> & Pick<MedicationProfile, 'prescribingPhysician' | 'conditionTreated'>): MedicationProfile {
  return makeMedicationProfile({
    id: overrides.id ?? 'med-1',
    drugName: 'Drug',
    prescribingPhysician: overrides.prescribingPhysician,
    conditionTreated: overrides.conditionTreated,
    ...overrides,
  });
}

describe('suggestPrescribingPhysicians', () => {
  const medications = [
    med({ id: '1', prescribingPhysician: 'Dr. Smith', conditionTreated: 'POTS' }),
    med({ id: '2', prescribingPhysician: 'Dr. Smith', conditionTreated: 'Migraine' }),
    med({ id: '3', prescribingPhysician: 'Dr. Jones', conditionTreated: 'POTS' }),
  ];

  it('returns distinct values sorted alphabetically', () => {
    expect(suggestPrescribingPhysicians(medications, '')).toEqual(['Dr. Jones', 'Dr. Smith']);
  });

  it('filters case-insensitively by query', () => {
    expect(suggestPrescribingPhysicians(medications, 'smith')).toEqual(['Dr. Smith']);
  });

  it('ignores blank stored values', () => {
    expect(
      suggestPrescribingPhysicians(
        [...medications, med({ id: '4', prescribingPhysician: '  ', conditionTreated: 'X' })],
        '',
      ),
    ).toEqual(['Dr. Jones', 'Dr. Smith']);
  });
});

describe('buildPrnConfigFromDraft', () => {
  it('derives PRN dose from the regimen dosage fields', () => {
    const draft = emptyRegimenDraft();
    draft.dosageAmount = '2';
    draft.dosageUnit = 'spray';
    draft.prnSafetyLimit = '6';
    draft.scheduleKind = 'prn';

    expect(buildPrnConfigFromDraft(draft)).toEqual({
      doseAmount: 2,
      doseUnit: 'spray',
      safetyLimit24h: 6,
    });
  });
});

describe('suggestConditionsTreated', () => {
  const medications = [
    med({ id: '1', prescribingPhysician: 'Dr. Smith', conditionTreated: 'POTS' }),
    med({ id: '2', prescribingPhysician: 'Dr. Smith', conditionTreated: 'Migraine' }),
    med({ id: '3', prescribingPhysician: 'Dr. Jones', conditionTreated: 'pots' }),
  ];

  it('returns distinct values sorted alphabetically', () => {
    expect(suggestConditionsTreated(medications, '')).toEqual(['Migraine', 'POTS']);
  });

  it('filters case-insensitively by query', () => {
    expect(suggestConditionsTreated(medications, 'mig')).toEqual(['Migraine']);
  });
});
