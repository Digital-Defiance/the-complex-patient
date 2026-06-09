import { describe, it, expect } from 'vitest';
import type {
  Condition,
  SymptomEntry,
  SymptomDraft,
  Association,
  FlareUp,
  TimeUnit,
} from './symptoms';
import {
  validateSymptomEntry,
  validateAssociation,
  validateFlareUp,
} from './validation/symptoms';

describe('Symptom domain types', () => {
  describe('TimeUnit', () => {
    it('accepts all valid time unit values', () => {
      const units: TimeUnit[] = ['minutes', 'hours', 'days', 'weeks'];
      expect(units).toHaveLength(4);
    });
  });

  describe('Condition', () => {
    it('extends VaultRecord with a name field', () => {
      const condition: Condition = {
        id: 'cond-1',
        op_timestamp: '2024-01-15T10:00:00Z',
        name: 'POTS',
      };
      expect(condition.name).toBe('POTS');
      expect(condition.id).toBe('cond-1');
    });
  });

  describe('SymptomEntry', () => {
    it('has all required fields', () => {
      const entry: SymptomEntry = {
        id: 'sym-1',
        op_timestamp: '2024-01-15T10:00:00Z',
        symptomType: 'Tachycardia',
        systemicLocation: 'Cardiovascular',
        severity: 7,
        duration: { value: 30, unit: 'minutes' },
        notes: 'Occurred after standing',
        active: true,
      };
      expect(entry.symptomType).toBe('Tachycardia');
      expect(entry.severity).toBe(7);
      expect(entry.duration.unit).toBe('minutes');
      expect(entry.active).toBe(true);
    });
  });

  describe('SymptomDraft', () => {
    it('allows all fields to be optional', () => {
      const draft: SymptomDraft = {};
      expect(draft.symptomType).toBeUndefined();
    });

    it('allows partial fields', () => {
      const draft: SymptomDraft = {
        symptomType: 'Nausea',
        severity: 5,
      };
      expect(draft.symptomType).toBe('Nausea');
      expect(draft.systemicLocation).toBeUndefined();
    });
  });

  describe('Association', () => {
    it('links a symptom to conditions and medications', () => {
      const assoc: Association = {
        id: 'assoc-1',
        op_timestamp: '2024-01-15T10:00:00Z',
        symptomId: 'sym-1',
        conditionIds: ['cond-1', 'cond-2'],
        medicationIds: ['med-1'],
      };
      expect(assoc.conditionIds).toHaveLength(2);
      expect(assoc.medicationIds).toHaveLength(1);
    });
  });

  describe('FlareUp', () => {
    it('groups multiple symptoms with a trigger', () => {
      const flare: FlareUp = {
        id: 'flare-1',
        op_timestamp: '2024-01-15T10:00:00Z',
        symptomIds: ['sym-1', 'sym-2', 'sym-3'],
        trigger: 'Weather change',
      };
      expect(flare.symptomIds).toHaveLength(3);
      expect(flare.trigger).toBe('Weather change');
    });
  });
});

describe('validateSymptomEntry', () => {
  const validInput = {
    symptomType: 'Headache',
    systemicLocation: 'Neurological',
    severity: 5,
    duration: { value: 2, unit: 'hours' },
    notes: 'Mild throbbing',
  };

  it('returns valid for correct input', () => {
    const result = validateSymptomEntry(validInput);
    expect(result.valid).toBe(true);
  });

  it('rejects empty symptomType', () => {
    const result = validateSymptomEntry({ ...validInput, symptomType: '' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'symptomType')).toBe(true);
    }
  });

  it('rejects whitespace-only symptomType', () => {
    const result = validateSymptomEntry({ ...validInput, symptomType: '   ' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'symptomType')).toBe(true);
    }
  });

  it('rejects empty systemicLocation', () => {
    const result = validateSymptomEntry({ ...validInput, systemicLocation: '' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'systemicLocation')).toBe(true);
    }
  });

  it('rejects non-integer severity', () => {
    const result = validateSymptomEntry({ ...validInput, severity: 5.5 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    }
  });

  it('rejects severity below 1', () => {
    const result = validateSymptomEntry({ ...validInput, severity: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
      expect(result.errors.find((e) => e.field === 'severity')!.message).toContain('between 1 and 10');
    }
  });

  it('rejects severity above 10', () => {
    const result = validateSymptomEntry({ ...validInput, severity: 11 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    }
  });

  it('accepts severity at boundaries (1 and 10)', () => {
    expect(validateSymptomEntry({ ...validInput, severity: 1 }).valid).toBe(true);
    expect(validateSymptomEntry({ ...validInput, severity: 10 }).valid).toBe(true);
  });

  it('rejects zero duration value', () => {
    const result = validateSymptomEntry({
      ...validInput,
      duration: { value: 0, unit: 'hours' },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'duration.value')).toBe(true);
    }
  });

  it('rejects negative duration value', () => {
    const result = validateSymptomEntry({
      ...validInput,
      duration: { value: -1, unit: 'hours' },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'duration.value')).toBe(true);
    }
  });

  it('rejects invalid duration unit', () => {
    const result = validateSymptomEntry({
      ...validInput,
      duration: { value: 5, unit: 'months' },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'duration.unit')).toBe(true);
    }
  });

  it('rejects notes exceeding 2000 characters', () => {
    const result = validateSymptomEntry({
      ...validInput,
      notes: 'x'.repeat(2001),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'notes')).toBe(true);
    }
  });

  it('accepts notes at exactly 2000 characters', () => {
    const result = validateSymptomEntry({
      ...validInput,
      notes: 'x'.repeat(2000),
    });
    expect(result.valid).toBe(true);
  });

  it('reports multiple errors at once', () => {
    const result = validateSymptomEntry({
      symptomType: '',
      systemicLocation: '',
      severity: 15,
      duration: { value: -1, unit: 'invalid' },
      notes: 'x'.repeat(2001),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('accepts empty notes string', () => {
    const result = validateSymptomEntry({ ...validInput, notes: '' });
    expect(result.valid).toBe(true);
  });
});

describe('validateAssociation', () => {
  it('returns valid for 1 condition and empty medications', () => {
    const result = validateAssociation({
      conditionIds: ['cond-1'],
      medicationIds: [],
    });
    expect(result.valid).toBe(true);
  });

  it('returns valid for 50 conditions', () => {
    const result = validateAssociation({
      conditionIds: Array.from({ length: 50 }, (_, i) => `cond-${i}`),
      medicationIds: [],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty conditionIds array', () => {
    const result = validateAssociation({
      conditionIds: [],
      medicationIds: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'conditionIds')).toBe(true);
      expect(result.errors.find((e) => e.field === 'conditionIds')!.message).toContain('At least 1');
    }
  });

  it('rejects more than 50 conditions', () => {
    const result = validateAssociation({
      conditionIds: Array.from({ length: 51 }, (_, i) => `cond-${i}`),
      medicationIds: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'conditionIds')).toBe(true);
      expect(result.errors.find((e) => e.field === 'conditionIds')!.message).toContain('50');
    }
  });

  it('accepts 1–50 medications when present', () => {
    const result = validateAssociation({
      conditionIds: ['cond-1'],
      medicationIds: ['med-1'],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects more than 50 medications', () => {
    const result = validateAssociation({
      conditionIds: ['cond-1'],
      medicationIds: Array.from({ length: 51 }, (_, i) => `med-${i}`),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'medicationIds')).toBe(true);
    }
  });

  it('allows empty medicationIds (no adverse reaction flagged)', () => {
    const result = validateAssociation({
      conditionIds: ['cond-1'],
      medicationIds: [],
    });
    expect(result.valid).toBe(true);
  });
});

describe('validateFlareUp', () => {
  it('returns valid for 2 symptoms with short trigger', () => {
    const result = validateFlareUp({
      symptomIds: ['sym-1', 'sym-2'],
      trigger: 'Weather change',
    });
    expect(result.valid).toBe(true);
  });

  it('returns valid for 50 symptoms', () => {
    const result = validateFlareUp({
      symptomIds: Array.from({ length: 50 }, (_, i) => `sym-${i}`),
      trigger: '',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects fewer than 2 symptoms', () => {
    const result = validateFlareUp({
      symptomIds: ['sym-1'],
      trigger: '',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
      expect(result.errors.find((e) => e.field === 'symptomIds')!.message).toContain('At least 2');
    }
  });

  it('rejects empty symptomIds array', () => {
    const result = validateFlareUp({
      symptomIds: [],
      trigger: '',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
    }
  });

  it('rejects more than 50 symptoms', () => {
    const result = validateFlareUp({
      symptomIds: Array.from({ length: 51 }, (_, i) => `sym-${i}`),
      trigger: '',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
      expect(result.errors.find((e) => e.field === 'symptomIds')!.message).toContain('50');
    }
  });

  it('rejects trigger exceeding 500 characters', () => {
    const result = validateFlareUp({
      symptomIds: ['sym-1', 'sym-2'],
      trigger: 'x'.repeat(501),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'trigger')).toBe(true);
    }
  });

  it('accepts trigger at exactly 500 characters', () => {
    const result = validateFlareUp({
      symptomIds: ['sym-1', 'sym-2'],
      trigger: 'x'.repeat(500),
    });
    expect(result.valid).toBe(true);
  });

  it('accepts empty trigger string', () => {
    const result = validateFlareUp({
      symptomIds: ['sym-1', 'sym-2'],
      trigger: '',
    });
    expect(result.valid).toBe(true);
  });
});
