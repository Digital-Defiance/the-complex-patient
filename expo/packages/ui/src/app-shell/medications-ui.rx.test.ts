import { describe, expect, it } from 'vitest';
import {
  applyBarcodeScanToDraft,
  applyDrugNameChangeToDraft,
  applyProductCodeChangeToDraft,
  buildProfileFromDraft,
  draftFromProfile,
  emptyMedicationDraft,
  medicationIdentityBaseline,
  mergeMedicationRecord,
  resolveMedicationNamingNoticesForUi,
  resolveMedicationRxLabel,
  resolveMedicationRxLabelForUi,
  resolveRxMatchConfirmView,
  shouldInvalidateConfirmedRxMatch,
  shouldShowRxMatchConfirmPanel,
} from './medications-ui';
import type { MedicationProfile } from '@complex-patient/domain';

describe('medications-ui rx identity', () => {
  it('persists confirmed rx fields on buildProfileFromDraft', () => {
    const draft = {
      ...emptyMedicationDraft(),
      drugName: 'Advil',
      rxcui: '5640',
      ingredientRxcui: '5640',
      rxDisplayName: 'Ibuprofen',
      rxMatchConfidence: '0.92',
      userConfirmedRxMatch: true as const,
      rxnormDatasetVersion: '2026.06-seed',
    };

    const profile = buildProfileFromDraft(draft);
    expect(profile.rxcui).toBe('5640');
    expect(profile.ingredientRxcui).toBe('5640');
    expect(profile.rxDisplayName).toBe('Ibuprofen');
    expect(profile.rxMatchConfidence).toBe(0.92);
    expect(profile.userConfirmedRxMatch).toBe(true);
    expect(profile.rxnormDatasetVersion).toBe('2026.06-seed');
  });

  it('marks declined matches without generic fields', () => {
    const draft = {
      ...emptyMedicationDraft(),
      drugName: 'Unknown herb',
      userConfirmedRxMatch: false as const,
      rxnormDatasetVersion: '2026.06-seed',
    };

    const profile = buildProfileFromDraft(draft);
    expect(profile.userConfirmedRxMatch).toBe(false);
    expect(profile.rxcui).toBeUndefined();
    expect(profile.rxDisplayName).toBeUndefined();
  });

  it('round-trips rx fields through draftFromProfile', () => {
    const profile: MedicationProfile = {
      id: 'med-1',
      op_timestamp: '2026-06-25T00:00:00.000Z',
      drugName: 'Motrin',
      prescribingPhysician: '',
      conditionTreated: '',
      active: true,
      regimens: [],
      rxcui: '5640',
      ingredientRxcui: '5640',
      rxDisplayName: 'Ibuprofen',
      rxMatchConfidence: 0.88,
      userConfirmedRxMatch: true,
      rxnormDatasetVersion: '2026.06-seed',
    };

    const draft = draftFromProfile(profile);
    expect(draft.rxDisplayName).toBe('Ibuprofen');
    expect(draft.userConfirmedRxMatch).toBe(true);
  });
});

describe('medications-ui rx draft edits', () => {
  const baseline = medicationIdentityBaseline({
    drugName: 'Advil',
    productCode: '00573-0150-70',
  });

  it('clears rx fields when editing a confirmed drug name away from baseline', () => {
    const draft = {
      ...emptyMedicationDraft(),
      drugName: 'Advil',
      productCode: '00573-0150-70',
      rxcui: '5640',
      rxDisplayName: 'Ibuprofen',
      userConfirmedRxMatch: true as const,
    };

    const next = applyDrugNameChangeToDraft(draft, baseline, 'Motrin');
    expect(next.drugName).toBe('Motrin');
    expect(next.userConfirmedRxMatch).toBeNull();
    expect(next.rxcui).toBe('');
  });

  it('keeps rx fields when drug name matches baseline on edit load', () => {
    const draft = {
      ...emptyMedicationDraft(),
      drugName: 'Advil',
      productCode: '00573-0150-70',
      rxcui: '5640',
      userConfirmedRxMatch: true as const,
    };

    const next = applyDrugNameChangeToDraft(draft, baseline, 'Advil');
    expect(next.userConfirmedRxMatch).toBe(true);
    expect(next.rxcui).toBe('5640');
  });

  it('clears rx fields when product code changes', () => {
    const draft = {
      ...emptyMedicationDraft(),
      drugName: 'Advil',
      productCode: '00573-0150-70',
      rxcui: '5640',
      userConfirmedRxMatch: true as const,
    };

    const next = applyProductCodeChangeToDraft(draft, baseline, '00904-1982-60');
    expect(next.productCode).toBe('00904-1982-60');
    expect(next.userConfirmedRxMatch).toBeNull();
  });

  it('fills drug name from barcode lookup when empty and clears rx confirmation', () => {
    const draft = {
      ...emptyMedicationDraft(),
      drugName: '',
      productCode: '',
    };

    const next = applyBarcodeScanToDraft(draft, medicationIdentityBaseline(), '00573-0150-70', 'Ibuprofen');
    expect(next.productCode).toBe('00573-0150-70');
    expect(next.drugName).toBe('Ibuprofen');
    expect(next.userConfirmedRxMatch).toBeNull();
  });

  it('invalidates confirmed match when pending candidate rxcui differs', () => {
    expect(
      shouldInvalidateConfirmedRxMatch(
        { userConfirmedRxMatch: true, rxcui: '5640' },
        '7258',
      ),
    ).toBe(true);
    expect(
      shouldInvalidateConfirmedRxMatch(
        { userConfirmedRxMatch: true, rxcui: '5640' },
        '5640',
      ),
    ).toBe(false);
  });
});

describe('medications-ui rx display helpers', () => {
  it('resolves rx label kinds', () => {
    expect(
      resolveMedicationRxLabel({
        drugName: 'Advil',
        rxDisplayName: 'Ibuprofen',
        userConfirmedRxMatch: true,
      }),
    ).toEqual({ kind: 'stored-as', generic: 'Ibuprofen' });

    expect(
      resolveMedicationRxLabel({
        drugName: 'Ibuprofen',
        rxDisplayName: 'Ibuprofen',
        userConfirmedRxMatch: true,
      }),
    ).toEqual({ kind: 'matched' });

    expect(
      resolveMedicationRxLabel({
        drugName: 'Herb X',
        userConfirmedRxMatch: false,
      }),
    ).toEqual({ kind: 'unidentified' });

    expect(
      resolveMedicationRxLabel({
        drugName: 'Advil',
        userConfirmedRxMatch: null,
      }),
    ).toBeNull();
  });

  it('resolves rx match confirm panel views', () => {
    expect(resolveRxMatchConfirmView(true, null)).toBe('prompt');
    expect(resolveRxMatchConfirmView(true, true)).toBe('confirmed');
    expect(resolveRxMatchConfirmView(true, false)).toBe('declined');
    expect(resolveRxMatchConfirmView(false, false)).toBe('unidentified');
    expect(resolveRxMatchConfirmView(false, null)).toBe('hidden');
  });
});

describe('medications-ui kill switch', () => {
  const confirmedMed = {
    drugName: 'Advil',
    rxDisplayName: 'Ibuprofen',
    userConfirmedRxMatch: true as const,
  };

  it('suppresses rx labels when assist is disabled', () => {
    expect(resolveMedicationRxLabelForUi(confirmedMed, false)).toBeNull();
    expect(resolveMedicationRxLabelForUi(confirmedMed, true)).toEqual({
      kind: 'stored-as',
      generic: 'Ibuprofen',
    });
  });

  it('suppresses overlap notices when assist is disabled', () => {
    const meds: MedicationProfile[] = [
      {
        id: 'a',
        op_timestamp: '2026-06-25T00:00:00.000Z',
        drugName: 'Advil',
        prescribingPhysician: '',
        conditionTreated: '',
        active: true,
        regimens: [],
        userConfirmedRxMatch: true,
        ingredientRxcui: '5640',
        rxDisplayName: 'Ibuprofen',
        rxcui: '5640',
      },
      {
        id: 'b',
        op_timestamp: '2026-06-25T00:00:00.000Z',
        drugName: 'Motrin',
        prescribingPhysician: '',
        conditionTreated: '',
        active: true,
        regimens: [],
        userConfirmedRxMatch: true,
        ingredientRxcui: '5640',
        rxDisplayName: 'Ibuprofen',
        rxcui: '5640',
      },
    ];

    expect(resolveMedicationNamingNoticesForUi(meds, false)).toEqual([]);
    expect(resolveMedicationNamingNoticesForUi(meds, true).length).toBeGreaterThan(0);
  });

  it('suppresses confirm panel when assist is disabled', () => {
    expect(
      shouldShowRxMatchConfirmPanel(
        { drugName: 'Advil', productCode: '' },
        { confidence: 0.95 },
        { assistEnabled: false },
      ),
    ).toBe(false);
  });
});

describe('medications-ui rx form flow', () => {
  const existing: MedicationProfile = {
    id: 'med-1',
    op_timestamp: '2026-06-25T00:00:00.000Z',
    drugName: 'Advil',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'Pain',
    active: true,
    regimens: [],
    rxcui: '5640',
    ingredientRxcui: '5640',
    rxDisplayName: 'Ibuprofen',
    rxMatchConfidence: 0.91,
    userConfirmedRxMatch: true,
    rxnormDatasetVersion: 'seed-2026',
  };

  it('shows confirm panel for high-confidence matches and NDC-resolved codes', () => {
    expect(
      shouldShowRxMatchConfirmPanel({ drugName: 'Advil', productCode: '' }, { confidence: 0.9 }),
    ).toBe(true);
    expect(
      shouldShowRxMatchConfirmPanel({ drugName: 'Advil', productCode: '' }, { confidence: 0.5 }),
    ).toBe(false);
    expect(
      shouldShowRxMatchConfirmPanel(
        { drugName: 'Advil', productCode: '00573-0150-70' },
        { confidence: 0.5 },
        { resolveNdc: () => '5640' },
      ),
    ).toBe(true);
    expect(shouldShowRxMatchConfirmPanel({ drugName: '', productCode: '' }, { confidence: 0.9 })).toBe(
      false,
    );
  });

  it('clears stored rx identity when user declines on save', () => {
    const declinedDraft = {
      ...draftFromProfile(existing),
      userConfirmedRxMatch: false as const,
      rxcui: '',
      ingredientRxcui: '',
      rxDisplayName: '',
      rxMatchConfidence: '',
    };

    const profile = buildProfileFromDraft(declinedDraft, existing);
    expect(profile.userConfirmedRxMatch).toBe(false);
    expect(profile.rxcui).toBeUndefined();
    expect(profile.rxDisplayName).toBeUndefined();

    const records = mergeMedicationRecord([existing], profile);
    expect(records[0]?.rxcui).toBeUndefined();
    expect(records[0]?.userConfirmedRxMatch).toBe(false);
  });

  it('invalidates confirmed match when pending candidate differs after drug edit', () => {
    const draft = {
      ...draftFromProfile(existing),
      drugName: 'Motrin',
    };
    const baseline = medicationIdentityBaseline(existing);
    const edited = applyDrugNameChangeToDraft(draft, baseline, 'Motrin');

    expect(edited.userConfirmedRxMatch).toBeNull();
    expect(edited.rxcui).toBe('');
    expect(
      shouldInvalidateConfirmedRxMatch(
        { userConfirmedRxMatch: true, rxcui: '5640' },
        '7258',
      ),
    ).toBe(true);
  });
});
