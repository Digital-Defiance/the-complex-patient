/**
 * Cross-package QA integration — drug naming from form draft through export surfaces.
 */

import { describe, expect, it } from 'vitest';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import { buildClinicalSummaryMarkdown } from '@complex-patient/clinical-export';
import { buildFhirBundle, parseFhirBundleToSource } from '@complex-patient/clinical-export';
import {
  buildConfirmedRxIdentity,
  buildMedicationNamingNotices,
  matchMedicationName,
  medicationForNamingCheck,
} from '@complex-patient/drug-naming';
import { buildPhysicianReport, createInMemoryReportDataSource } from '@complex-patient/insights';
import {
  applyDrugNameChangeToDraft,
  buildProfileFromDraft,
  emptyMedicationDraft,
  medicationIdentityBaseline,
} from './medications-ui';

describe('drug naming QA integration', () => {
  it('covers match → confirm → vault profile → export → report', () => {
    const match = matchMedicationName('Advil');
    expect(match.candidate?.displayName).toBe('Ibuprofen');

    const identity = buildConfirmedRxIdentity(match.candidate!);
    const draft = {
      ...emptyMedicationDraft(),
      drugName: 'Advil',
      rxcui: identity.rxcui,
      ingredientRxcui: identity.ingredientRxcui,
      rxDisplayName: identity.rxDisplayName,
      rxMatchConfidence: String(identity.rxMatchConfidence),
      userConfirmedRxMatch: true as const,
      rxnormDatasetVersion: identity.rxnormDatasetVersion,
    };

    const profile = buildProfileFromDraft(draft);
    expect(profile.userConfirmedRxMatch).toBe(true);
    expect(profile.rxDisplayName).toBe('Ibuprofen');

    const exportSource = {
      medications: [profile],
      prnLogs: [],
      symptoms: [],
      conditions: [],
      flares: [],
      associations: [],
    };

    const markdown = buildClinicalSummaryMarkdown(exportSource, '2026-06-25T12:00:00.000Z');
    expect(markdown).toContain('Advil (naming database: Ibuprofen)');
    expect(markdown).toContain('RxCUI');

    const bundle = buildFhirBundle(exportSource, '2026-06-25T12:00:00.000Z');
    const parsed = parseFhirBundleToSource(bundle);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.source.medications[0]?.rxcui).toBe(identity.rxcui);

    const report = buildPhysicianReport(
      createInMemoryReportDataSource({ medications: [profile] }),
      { now: () => new Date('2026-06-25T12:00:00.000Z') },
    );
    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.report.sections[0]?.lines[0]).toContain('Ibuprofen');
    expect(report.report.sections[0]?.lines[0]).toContain('RxCUI');
  });

  it('clears confirmation when user edits drug identity away from baseline', () => {
    const existing = makeTestMedicationProfile({
      id: 'med-1',
      drugName: 'Advil',
      productCode: '00573-0150-70',
      rxcui: '5640',
      rxDisplayName: 'Ibuprofen',
      userConfirmedRxMatch: true,
    });

    const baseline = medicationIdentityBaseline(existing);
    const draft = {
      ...emptyMedicationDraft(),
      drugName: existing.drugName,
      productCode: existing.productCode ?? '',
      rxcui: existing.rxcui ?? '',
      rxDisplayName: existing.rxDisplayName ?? '',
      userConfirmedRxMatch: true as const,
    };

    const edited = applyDrugNameChangeToDraft(draft, baseline, 'Motrin');
    expect(edited.userConfirmedRxMatch).toBeNull();
    expect(edited.rxcui).toBe('');

    const saved = buildProfileFromDraft(edited, existing);
    expect(saved.userConfirmedRxMatch).toBeUndefined();
    expect(saved.rxcui).toBeUndefined();
  });

  it('surfaces duplicate-ingredient notice only after confirmation', () => {
    const unconfirmed = [
      medicationForNamingCheck({
        id: 'a',
        drugName: 'Advil',
        active: true,
        userConfirmedRxMatch: false,
      }),
      medicationForNamingCheck({
        id: 'b',
        drugName: 'Motrin',
        active: true,
        userConfirmedRxMatch: false,
      }),
    ];
    expect(buildMedicationNamingNotices(unconfirmed)).toHaveLength(0);

    const confirmed = [
      medicationForNamingCheck({
        id: 'a',
        drugName: 'Advil',
        active: true,
        userConfirmedRxMatch: true,
        ingredientRxcui: '5640',
        rxDisplayName: 'Ibuprofen',
        rxcui: '5640',
      }),
      medicationForNamingCheck({
        id: 'b',
        drugName: 'Motrin',
        active: true,
        userConfirmedRxMatch: true,
        ingredientRxcui: '5640',
        rxDisplayName: 'Ibuprofen',
        rxcui: '5640',
      }),
    ];
    expect(buildMedicationNamingNotices(confirmed).some((n) => n.kind === 'duplicate-ingredient')).toBe(
      true,
    );
  });
});
