/**
 * Comprehensive boundary-value tests for domain validation.
 *
 * Tests exact boundary cases for field length, severity, interval, PRN limit,
 * cardinality, notes length, trigger length, per-field error reporting, and
 * whole-record rejection on invalid input.
 *
 * Requirements: 10.2, 11.4, 13.4, 15.3, 15.4, 15.5, 16.1, 17.1
 */
import { describe, it, expect } from 'vitest';
import {
  validateMedicationProfile,
  validateMedicationSchedule,
  validatePrnSafetyLimit,
} from './validation/medications';
import {
  validateSymptomEntry,
  validateAssociation,
  validateFlareUp,
} from './validation/symptoms';

describe('Boundary: Medication profile field length (Req 10.2)', () => {
  const baseProfile = {
    drugName: 'Metoprolol',
    dosage: '25mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'POTS',
  };

  describe('exact boundary at 200 characters per individual field', () => {
    const fields = ['drugName', 'dosage', 'form', 'prescribingPhysician', 'conditionTreated'] as const;

    for (const field of fields) {
      it(`accepts ${field} at exactly 200 chars`, () => {
        const result = validateMedicationProfile({ ...baseProfile, [field]: 'a'.repeat(200) });
        expect(result.valid).toBe(true);
      });

      it(`rejects ${field} at 201 chars`, () => {
        const result = validateMedicationProfile({ ...baseProfile, [field]: 'a'.repeat(201) });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].field).toBe(field);
          expect(result.errors[0].message).toContain('200');
        }
      });

      it(`accepts ${field} at exactly 1 char`, () => {
        const result = validateMedicationProfile({ ...baseProfile, [field]: 'x' });
        expect(result.valid).toBe(true);
      });

      it(`rejects ${field} when empty string (0 chars)`, () => {
        const result = validateMedicationProfile({ ...baseProfile, [field]: '' });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].field).toBe(field);
        }
      });
    }
  });
});

describe('Boundary: Severity range (Req 15.4)', () => {
  const baseSymptom = {
    symptomType: 'Headache',
    systemicLocation: 'Neurological',
    severity: 5,
    duration: { value: 1, unit: 'hours' },
    notes: '',
  };

  it('rejects severity = 0 (below lower bound)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
      expect(result.errors.find((e) => e.field === 'severity')!.message).toContain('between 1 and 10');
    }
  });

  it('accepts severity = 1 (lower bound)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: 1 });
    expect(result.valid).toBe(true);
  });

  it('accepts severity = 10 (upper bound)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: 10 });
    expect(result.valid).toBe(true);
  });

  it('rejects severity = 11 (above upper bound)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: 11 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    }
  });

  it('rejects negative severity', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: -1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    }
  });

  it('rejects decimal severity (e.g. 5.5)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: 5.5 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    }
  });

  it('rejects decimal at boundary (e.g. 1.5)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: 1.5 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    }
  });

  it('rejects large negative severity', () => {
    const result = validateSymptomEntry({ ...baseSymptom, severity: -100 });
    expect(result.valid).toBe(false);
  });
});

describe('Boundary: Rotating-interval range (Req 11.4)', () => {
  it('rejects everyNDays = 0 (below lower bound)', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: 0, times: ['08:00'] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('between 1 and 30');
    }
  });

  it('accepts everyNDays = 1 (lower bound)', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: 1, times: ['08:00'] });
    expect(result.valid).toBe(true);
  });

  it('accepts everyNDays = 30 (upper bound)', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: 30, times: ['08:00'] });
    expect(result.valid).toBe(true);
  });

  it('rejects everyNDays = 31 (above upper bound)', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: 31, times: ['08:00'] });
    expect(result.valid).toBe(false);
  });

  it('rejects negative everyNDays', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: -1, times: ['08:00'] });
    expect(result.valid).toBe(false);
  });

  it('rejects decimal everyNDays (e.g. 2.5)', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: 2.5, times: ['08:00'] });
    expect(result.valid).toBe(false);
  });

  it('rejects decimal at boundary (e.g. 1.1)', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: 1.1, times: ['08:00'] });
    expect(result.valid).toBe(false);
  });

  it('rejects decimal at upper boundary (e.g. 29.9)', () => {
    const result = validateMedicationSchedule({ kind: 'rotating-interval', everyNDays: 29.9, times: ['08:00'] });
    expect(result.valid).toBe(false);
  });
});

describe('Boundary: PRN safety limit range (Req 13.4)', () => {
  it('rejects 0 (below lower bound)', () => {
    const result = validatePrnSafetyLimit(0);
    expect(result.valid).toBe(false);
  });

  it('rejects 0.009 (just below lower bound)', () => {
    const result = validatePrnSafetyLimit(0.009);
    expect(result.valid).toBe(false);
  });

  it('accepts 0.01 (exact lower bound)', () => {
    const result = validatePrnSafetyLimit(0.01);
    expect(result.valid).toBe(true);
  });

  it('accepts 999999.99 (exact upper bound)', () => {
    const result = validatePrnSafetyLimit(999999.99);
    expect(result.valid).toBe(true);
  });

  it('rejects 1000000 (above upper bound)', () => {
    const result = validatePrnSafetyLimit(1000000);
    expect(result.valid).toBe(false);
  });

  it('rejects negative values', () => {
    const result = validatePrnSafetyLimit(-0.01);
    expect(result.valid).toBe(false);
  });

  it('rejects large negative', () => {
    const result = validatePrnSafetyLimit(-1000);
    expect(result.valid).toBe(false);
  });

  it('accepts value just above lower bound (0.02)', () => {
    const result = validatePrnSafetyLimit(0.02);
    expect(result.valid).toBe(true);
  });

  it('accepts value just below upper bound (999999.98)', () => {
    const result = validatePrnSafetyLimit(999999.98);
    expect(result.valid).toBe(true);
  });

  it('rejects NaN', () => {
    const result = validatePrnSafetyLimit(NaN);
    expect(result.valid).toBe(false);
  });

  it('rejects Infinity', () => {
    const result = validatePrnSafetyLimit(Infinity);
    expect(result.valid).toBe(false);
  });

  it('rejects -Infinity', () => {
    const result = validatePrnSafetyLimit(-Infinity);
    expect(result.valid).toBe(false);
  });
});

describe('Boundary: Cardinality limits (Req 16.1, 17.1)', () => {
  describe('Association conditionIds (1–50)', () => {
    it('rejects 0 conditions (empty array)', () => {
      const result = validateAssociation({ conditionIds: [], medicationIds: [] });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'conditionIds')).toBe(true);
      }
    });

    it('accepts exactly 1 condition (lower bound)', () => {
      const result = validateAssociation({ conditionIds: ['c-1'], medicationIds: [] });
      expect(result.valid).toBe(true);
    });

    it('accepts exactly 50 conditions (upper bound)', () => {
      const ids = Array.from({ length: 50 }, (_, i) => `c-${i}`);
      const result = validateAssociation({ conditionIds: ids, medicationIds: [] });
      expect(result.valid).toBe(true);
    });

    it('rejects 51 conditions (above upper bound)', () => {
      const ids = Array.from({ length: 51 }, (_, i) => `c-${i}`);
      const result = validateAssociation({ conditionIds: ids, medicationIds: [] });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'conditionIds')).toBe(true);
      }
    });
  });

  describe('Association medicationIds (1–50 when non-empty)', () => {
    it('accepts exactly 1 medication', () => {
      const result = validateAssociation({ conditionIds: ['c-1'], medicationIds: ['m-1'] });
      expect(result.valid).toBe(true);
    });

    it('accepts exactly 50 medications (upper bound)', () => {
      const ids = Array.from({ length: 50 }, (_, i) => `m-${i}`);
      const result = validateAssociation({ conditionIds: ['c-1'], medicationIds: ids });
      expect(result.valid).toBe(true);
    });

    it('rejects 51 medications (above upper bound)', () => {
      const ids = Array.from({ length: 51 }, (_, i) => `m-${i}`);
      const result = validateAssociation({ conditionIds: ['c-1'], medicationIds: ids });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'medicationIds')).toBe(true);
      }
    });
  });

  describe('FlareUp symptomIds (2–50)', () => {
    it('rejects 0 symptoms (empty array)', () => {
      const result = validateFlareUp({ symptomIds: [], trigger: '' });
      expect(result.valid).toBe(false);
    });

    it('rejects 1 symptom (below lower bound)', () => {
      const result = validateFlareUp({ symptomIds: ['s-1'], trigger: '' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
        expect(result.errors.find((e) => e.field === 'symptomIds')!.message).toContain('At least 2');
      }
    });

    it('accepts exactly 2 symptoms (lower bound)', () => {
      const result = validateFlareUp({ symptomIds: ['s-1', 's-2'], trigger: '' });
      expect(result.valid).toBe(true);
    });

    it('accepts exactly 50 symptoms (upper bound)', () => {
      const ids = Array.from({ length: 50 }, (_, i) => `s-${i}`);
      const result = validateFlareUp({ symptomIds: ids, trigger: '' });
      expect(result.valid).toBe(true);
    });

    it('rejects 51 symptoms (above upper bound)', () => {
      const ids = Array.from({ length: 51 }, (_, i) => `s-${i}`);
      const result = validateFlareUp({ symptomIds: ids, trigger: '' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
      }
    });
  });
});

describe('Boundary: Notes length (Req 15.5)', () => {
  const baseSymptom = {
    symptomType: 'Headache',
    systemicLocation: 'Neurological',
    severity: 5,
    duration: { value: 1, unit: 'hours' },
  };

  it('accepts notes at 1999 chars (just below boundary)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, notes: 'x'.repeat(1999) });
    expect(result.valid).toBe(true);
  });

  it('accepts notes at exactly 2000 chars (at boundary)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, notes: 'x'.repeat(2000) });
    expect(result.valid).toBe(true);
  });

  it('rejects notes at 2001 chars (above boundary)', () => {
    const result = validateSymptomEntry({ ...baseSymptom, notes: 'x'.repeat(2001) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'notes')).toBe(true);
      expect(result.errors.find((e) => e.field === 'notes')!.message).toContain('2000');
    }
  });

  it('accepts empty notes', () => {
    const result = validateSymptomEntry({ ...baseSymptom, notes: '' });
    expect(result.valid).toBe(true);
  });
});

describe('Boundary: Trigger length (Req 17.2)', () => {
  const validSymptoms = ['s-1', 's-2'];

  it('accepts trigger at 499 chars (just below boundary)', () => {
    const result = validateFlareUp({ symptomIds: validSymptoms, trigger: 'x'.repeat(499) });
    expect(result.valid).toBe(true);
  });

  it('accepts trigger at exactly 500 chars (at boundary)', () => {
    const result = validateFlareUp({ symptomIds: validSymptoms, trigger: 'x'.repeat(500) });
    expect(result.valid).toBe(true);
  });

  it('rejects trigger at 501 chars (above boundary)', () => {
    const result = validateFlareUp({ symptomIds: validSymptoms, trigger: 'x'.repeat(501) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'trigger')).toBe(true);
      expect(result.errors.find((e) => e.field === 'trigger')!.message).toContain('500');
    }
  });

  it('accepts empty trigger', () => {
    const result = validateFlareUp({ symptomIds: validSymptoms, trigger: '' });
    expect(result.valid).toBe(true);
  });
});

describe('Per-field error reporting: all invalid fields reported simultaneously (Req 10.2, 15.3)', () => {
  describe('Medication profile - reports ALL invalid fields at once', () => {
    it('reports all 5 fields when all are empty', () => {
      const result = validateMedicationProfile({
        drugName: '',
        dosage: '',
        form: '',
        prescribingPhysician: '',
        conditionTreated: '',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(5);
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('drugName');
        expect(fields).toContain('dosage');
        expect(fields).toContain('form');
        expect(fields).toContain('prescribingPhysician');
        expect(fields).toContain('conditionTreated');
      }
    });

    it('reports all 5 fields when all exceed 200 chars', () => {
      const tooLong = 'x'.repeat(201);
      const result = validateMedicationProfile({
        drugName: tooLong,
        dosage: tooLong,
        form: tooLong,
        prescribingPhysician: tooLong,
        conditionTreated: tooLong,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(5);
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('drugName');
        expect(fields).toContain('dosage');
        expect(fields).toContain('form');
        expect(fields).toContain('prescribingPhysician');
        expect(fields).toContain('conditionTreated');
      }
    });

    it('reports mix of empty and too-long errors together', () => {
      const result = validateMedicationProfile({
        drugName: '',
        dosage: 'x'.repeat(201),
        form: '',
        prescribingPhysician: 'Valid',
        conditionTreated: 'x'.repeat(201),
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(4);
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('drugName');
        expect(fields).toContain('dosage');
        expect(fields).toContain('form');
        expect(fields).toContain('conditionTreated');
      }
    });
  });

  describe('Symptom entry - reports ALL invalid fields at once', () => {
    it('reports all fields when everything is invalid', () => {
      const result = validateSymptomEntry({
        symptomType: '',
        systemicLocation: '',
        severity: 0,
        duration: { value: -1, unit: 'invalid' },
        notes: 'x'.repeat(2001),
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Should report: symptomType, systemicLocation, severity, duration.value, duration.unit, notes
        expect(result.errors.length).toBeGreaterThanOrEqual(5);
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('symptomType');
        expect(fields).toContain('systemicLocation');
        expect(fields).toContain('severity');
        expect(fields).toContain('duration.value');
        expect(fields).toContain('duration.unit');
        expect(fields).toContain('notes');
      }
    });

    it('reports both severity and notes errors simultaneously', () => {
      const result = validateSymptomEntry({
        symptomType: 'Headache',
        systemicLocation: 'Neuro',
        severity: 11,
        duration: { value: 1, unit: 'hours' },
        notes: 'x'.repeat(2001),
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(2);
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('severity');
        expect(fields).toContain('notes');
      }
    });
  });

  describe('FlareUp - reports both symptomIds and trigger errors simultaneously', () => {
    it('reports both errors when symptomIds < 2 AND trigger > 500', () => {
      const result = validateFlareUp({
        symptomIds: ['s-1'],
        trigger: 'x'.repeat(501),
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(2);
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('symptomIds');
        expect(fields).toContain('trigger');
      }
    });
  });

  describe('Association - reports both conditionIds and medicationIds errors simultaneously', () => {
    it('reports both errors when conditionIds empty AND medicationIds > 50', () => {
      const meds = Array.from({ length: 51 }, (_, i) => `m-${i}`);
      const result = validateAssociation({
        conditionIds: [],
        medicationIds: meds,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(2);
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('conditionIds');
        expect(fields).toContain('medicationIds');
      }
    });
  });
});

describe('Rejection of whole records: no partial data accepted (Req 10.2, 15.3)', () => {
  describe('Medication profile - entire record rejected on any invalid field', () => {
    it('rejects the entire profile when only one field is invalid', () => {
      const result = validateMedicationProfile({
        drugName: 'Valid Drug',
        dosage: 'x'.repeat(201), // only this is invalid
        form: 'tablet',
        prescribingPhysician: 'Dr. Jones',
        conditionTreated: 'Hypertension',
      });
      expect(result.valid).toBe(false);
      // The validation result is { valid: false } — nothing is partially accepted
    });

    it('returns valid: false (not partial acceptance) even with 4 of 5 fields valid', () => {
      const result = validateMedicationProfile({
        drugName: 'Good',
        dosage: 'Good',
        form: 'Good',
        prescribingPhysician: 'Good',
        conditionTreated: '', // only this is invalid
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].field).toBe('conditionTreated');
      }
    });
  });

  describe('Symptom entry - entire record rejected on any invalid field', () => {
    it('rejects the entire entry when only severity is out of range', () => {
      const result = validateSymptomEntry({
        symptomType: 'Valid',
        systemicLocation: 'Valid',
        severity: 11, // only this is invalid
        duration: { value: 1, unit: 'hours' },
        notes: '',
      });
      expect(result.valid).toBe(false);
      // No partial record is accepted
    });

    it('rejects the entire entry when only notes exceed limit', () => {
      const result = validateSymptomEntry({
        symptomType: 'Valid',
        systemicLocation: 'Valid',
        severity: 5,
        duration: { value: 1, unit: 'hours' },
        notes: 'x'.repeat(2001), // only this is invalid
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('FlareUp - entire record rejected on any invalid field', () => {
    it('rejects the flare-up entirely when only trigger is too long', () => {
      const result = validateFlareUp({
        symptomIds: ['s-1', 's-2'], // valid
        trigger: 'x'.repeat(501),   // only this is invalid
      });
      expect(result.valid).toBe(false);
    });

    it('rejects the flare-up entirely when only symptomIds count is too low', () => {
      const result = validateFlareUp({
        symptomIds: ['s-1'], // only this is invalid
        trigger: 'Short trigger',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('Association - entire record rejected on any invalid field', () => {
    it('rejects the association entirely when conditionIds is empty', () => {
      const result = validateAssociation({
        conditionIds: [], // invalid
        medicationIds: ['m-1'], // valid
      });
      expect(result.valid).toBe(false);
    });

    it('rejects the association entirely when medicationIds exceeds 50', () => {
      const meds = Array.from({ length: 51 }, (_, i) => `m-${i}`);
      const result = validateAssociation({
        conditionIds: ['c-1'], // valid
        medicationIds: meds,   // invalid
      });
      expect(result.valid).toBe(false);
    });
  });
});
