import { describe, expect, it } from 'vitest';
import {
  buildConfirmedRxIdentity,
  buildDeclinedRxIdentity,
  buildMedicationNamingNotices,
  extractProductCodeFromBarcode,
  formatMedicationExportLabel,
  formatMedicationRxAnnotation,
  getDrugNamingCatalog,
  matchMedicationName,
  medicationForNamingCheck,
  normalizeNdc,
  resolveRxcuiFromNdc,
  searchDrugNameSuggestions,
} from './index';

describe('drug-naming catalog', () => {
  it('ships an expanded seed catalog for common complex-care meds', () => {
    const catalog = getDrugNamingCatalog();
    expect(catalog.concepts.length).toBeGreaterThanOrEqual(56);
    expect(matchMedicationName('Plaquenil').candidate?.displayName).toBe('Hydroxychloroquine');
    expect(matchMedicationName('Adderall').candidate?.displayName).toBe('Amphetamine-Dextroamphetamine');
    expect(searchDrugNameSuggestions('meth')).toContain('Methotrexate');
  });

  it('keeps classIds and ndcMap references consistent with concept rows', () => {
    const catalog = getDrugNamingCatalog();
    const rxcuis = new Set(catalog.concepts.map((concept) => concept.rxcui));

    for (const concept of catalog.concepts) {
      for (const classId of concept.classIds) {
        expect(catalog.classes[classId], `${concept.rxcui} class ${classId}`).toBeDefined();
      }
    }

    for (const [ndc, rxcui] of Object.entries(catalog.ndcMap)) {
      expect(rxcuis.has(rxcui), `ndc ${ndc} -> ${rxcui}`).toBe(true);
    }
  });
});

describe('drug-naming matcher', () => {
  it('matches brand names to generic concepts', () => {
    const result = matchMedicationName('Advil');
    expect(result.candidate?.displayName).toBe('Ibuprofen');
    expect(result.candidate!.confidence).toBeGreaterThan(0.7);
  });

  it('suggests type-ahead labels', () => {
    const suggestions = searchDrugNameSuggestions('ibu');
    expect(suggestions).toContain('Ibuprofen');
  });

  it('resolves NDC to RxCUI', () => {
    expect(resolveRxcuiFromNdc('00573-0150-70')).toBe('5640');
    const fromNdc = matchMedicationName('', { rxcuiHint: resolveRxcuiFromNdc('00573-0150-70')! });
    expect(fromNdc.candidate?.displayName).toBe('Ibuprofen');
  });

  it('builds confirmed identity payload', () => {
    const match = matchMedicationName('Motrin');
    expect(match.candidate).not.toBeNull();
    const identity = buildConfirmedRxIdentity(match.candidate!);
    expect(identity.userConfirmedRxMatch).toBe(true);
    expect(identity.ingredientRxcui).toBe('5640');
    expect(identity.rxnormDatasetVersion).toBe(getDrugNamingCatalog().version);
  });

  it('builds declined identity without generic fields', () => {
    const declined = buildDeclinedRxIdentity();
    expect(declined.userConfirmedRxMatch).toBe(false);
    expect(declined.rxnormDatasetVersion).toBe(getDrugNamingCatalog().version);
    expect('rxcui' in declined).toBe(false);
    expect('rxDisplayName' in declined).toBe(false);
  });
});

describe('drug-naming overlap notices', () => {
  it('detects duplicate ingredients', () => {
    const meds = [
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
    const notices = buildMedicationNamingNotices(meds);
    expect(notices.some((notice) => notice.kind === 'duplicate-ingredient')).toBe(true);
  });

  it('detects same-class overlap across different ingredients', () => {
    const meds = [
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
        drugName: 'Aleve',
        active: true,
        userConfirmedRxMatch: true,
        ingredientRxcui: '7258',
        rxDisplayName: 'Naproxen',
        rxcui: '7258',
      }),
    ];
    const notices = buildMedicationNamingNotices(meds);
    expect(notices.some((notice) => notice.kind === 'same-class')).toBe(true);
  });

  it('skips unconfirmed meds', () => {
    const notices = buildMedicationNamingNotices([
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
    ]);
    expect(notices).toHaveLength(0);
  });
});

describe('drug-naming normalize', () => {
  it('extracts NDC from barcode payloads', () => {
    expect(extractProductCodeFromBarcode('00573-0150-70')).toBe('00573-0150-70');
    expect(extractProductCodeFromBarcode('00305730515070')).toBe('00305730515070');
    expect(extractProductCodeFromBarcode('')).toBe('');
  });

  it('normalizes NDC digit strings', () => {
    expect(normalizeNdc('00573-0150-70')).toBe('00573015070');
    expect(normalizeNdc('bad')).toBeNull();
  });
});

describe('drug-naming export labels', () => {
  it('includes confirmed generic when different from typed name', () => {
    const label = formatMedicationExportLabel({
      drugName: 'Advil',
      rxDisplayName: 'Ibuprofen',
      userConfirmedRxMatch: true,
      rxcui: '5640',
    });
    expect(label).toBe('Advil (naming database: Ibuprofen)');
  });

  it('builds Rx annotation for confirmed matches', () => {
    const note = formatMedicationRxAnnotation({
      rxcui: '5640',
      ingredientRxcui: '5640',
      rxnormDatasetVersion: 'seed-2026',
      userConfirmedRxMatch: true,
    });
    expect(note).toContain('RxCUI 5640');
    expect(note).toContain('dataset seed-2026');
  });
});
