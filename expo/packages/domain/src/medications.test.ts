import { describe, it, expect } from 'vitest';
import {
  validateMedicationProfile,
  validateMedicationSchedule,
  validatePrnSafetyLimit,
} from './validation/medications';
import type {
  MedicationProfile,
  MedicationSchedule,
  PrnLog,
  TaperPhase,
  PrnConfig,
  Weekday,
  TimeBlock,
} from './medications';

describe('Medication domain models', () => {
  describe('Type structure', () => {
    it('MedicationProfile extends VaultRecord', () => {
      const profile: MedicationProfile = {
        id: 'med-001',
        op_timestamp: '2024-01-15T10:00:00Z',
        drugName: 'Metoprolol',
        dosage: '25mg',
        form: 'tablet',
        prescribingPhysician: 'Dr. Smith',
        conditionTreated: 'POTS',
        active: true,
        schedule: { kind: 'weekly', daysOfWeek: ['MON', 'WED', 'FRI'], times: ['08:00'] },
      };
      expect(profile.id).toBe('med-001');
      expect(profile.drugName).toBe('Metoprolol');
    });

    it('PrnLog extends VaultRecord', () => {
      const log: PrnLog = {
        id: 'log-001',
        op_timestamp: '2024-01-15T14:00:00Z',
        medicationId: 'med-001',
        amount: 5,
        takenAt: '2024-01-15T14:00:00Z',
        override: false,
      };
      expect(log.medicationId).toBe('med-001');
      expect(log.override).toBe(false);
    });

    it('supports all schedule variants', () => {
      const schedules: MedicationSchedule[] = [
        { kind: 'prn' },
        { kind: 'weekly', daysOfWeek: ['MON'], times: ['08:00'] },
        { kind: 'alternating', startDate: '2024-01-01', times: ['09:00'] },
        { kind: 'rotating-interval', everyNDays: 3, times: ['10:00'] },
        { kind: 'taper', phases: [{ weekIndex: 0, dosage: '50mg' }] },
      ];
      expect(schedules).toHaveLength(5);
    });

    it('Weekday type covers all 7 days', () => {
      const days: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      expect(days).toHaveLength(7);
    });

    it('TimeBlock type covers all 4 blocks', () => {
      const blocks: TimeBlock[] = ['Morning', 'Midday', 'Evening', 'Night/Bedtime'];
      expect(blocks).toHaveLength(4);
    });
  });
});

describe('validateMedicationProfile', () => {
  const validInput = {
    drugName: 'Metoprolol',
    dosage: '25mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'POTS',
  };

  it('accepts a valid profile with all fields populated', () => {
    const result = validateMedicationProfile(validInput);
    expect(result.valid).toBe(true);
  });

  it('accepts fields at exactly 1 character', () => {
    const result = validateMedicationProfile({
      drugName: 'A',
      dosage: 'B',
      form: 'C',
      prescribingPhysician: 'D',
      conditionTreated: 'E',
    });
    expect(result.valid).toBe(true);
  });

  it('accepts fields at exactly 200 characters', () => {
    const longStr = 'x'.repeat(200);
    const result = validateMedicationProfile({
      drugName: longStr,
      dosage: longStr,
      form: longStr,
      prescribingPhysician: longStr,
      conditionTreated: longStr,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty drugName with per-field error', () => {
    const result = validateMedicationProfile({ ...validInput, drugName: '' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('drugName');
    }
  });

  it('rejects field exceeding 200 characters', () => {
    const result = validateMedicationProfile({ ...validInput, dosage: 'x'.repeat(201) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('dosage');
    }
  });

  it('reports multiple invalid required fields simultaneously', () => {
    const result = validateMedicationProfile({
      drugName: '',
      dosage: '',
      form: 'tablet',
      prescribingPhysician: '',
      conditionTreated: 'POTS',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(2);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain('drugName');
      expect(fields).toContain('dosage');
    }
  });

  it('accepts empty optional prescriber and condition fields', () => {
    const result = validateMedicationProfile({
      ...validInput,
      prescribingPhysician: '',
      conditionTreated: '',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects all required fields when drugName, dosage, and form are empty', () => {
    const result = validateMedicationProfile({
      drugName: '',
      dosage: '',
      form: '',
      prescribingPhysician: '',
      conditionTreated: '',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(3);
    }
  });
});

describe('validateMedicationSchedule', () => {
  it('accepts a valid weekly schedule with at least one day', () => {
    const result = validateMedicationSchedule({
      kind: 'weekly',
      daysOfWeek: ['MON'],
      times: ['08:00'],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a weekly schedule with no selected days', () => {
    const result = validateMedicationSchedule({
      kind: 'weekly',
      daysOfWeek: [],
      times: ['08:00'],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('at least one selected day');
    }
  });

  it('accepts rotating-interval with N=1 (lower bound)', () => {
    const result = validateMedicationSchedule({
      kind: 'rotating-interval',
      everyNDays: 1,
      times: ['08:00'],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts rotating-interval with N=30 (upper bound)', () => {
    const result = validateMedicationSchedule({
      kind: 'rotating-interval',
      everyNDays: 30,
      times: ['08:00'],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects rotating-interval with N=0', () => {
    const result = validateMedicationSchedule({
      kind: 'rotating-interval',
      everyNDays: 0,
      times: ['08:00'],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('between 1 and 30');
    }
  });

  it('rejects rotating-interval with N=31', () => {
    const result = validateMedicationSchedule({
      kind: 'rotating-interval',
      everyNDays: 31,
      times: ['08:00'],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects rotating-interval with non-integer N', () => {
    const result = validateMedicationSchedule({
      kind: 'rotating-interval',
      everyNDays: 2.5,
      times: ['08:00'],
    });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid taper schedule with non-empty dosage in all phases', () => {
    const result = validateMedicationSchedule({
      kind: 'taper',
      phases: [
        { weekIndex: 0, dosage: '50mg' },
        { weekIndex: 1, dosage: '25mg' },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a taper phase with empty dosage', () => {
    const result = validateMedicationSchedule({
      kind: 'taper',
      phases: [
        { weekIndex: 0, dosage: '50mg' },
        { weekIndex: 1, dosage: '' },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('phase 1');
      expect(result.message).toContain('non-empty dosage');
    }
  });

  it('rejects a taper schedule with no phases', () => {
    const result = validateMedicationSchedule({
      kind: 'taper',
      phases: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('at least one phase');
    }
  });

  it('accepts a PRN schedule', () => {
    const result = validateMedicationSchedule({ kind: 'prn' });
    expect(result.valid).toBe(true);
  });

  it('accepts an alternating schedule', () => {
    const result = validateMedicationSchedule({
      kind: 'alternating',
      startDate: '2024-01-01',
      times: ['09:00'],
    });
    expect(result.valid).toBe(true);
  });
});

describe('validatePrnSafetyLimit', () => {
  it('accepts 0.01 (lower bound)', () => {
    const result = validatePrnSafetyLimit(0.01);
    expect(result.valid).toBe(true);
  });

  it('accepts 999999.99 (upper bound)', () => {
    const result = validatePrnSafetyLimit(999999.99);
    expect(result.valid).toBe(true);
  });

  it('accepts a value in the middle of the range', () => {
    const result = validatePrnSafetyLimit(500);
    expect(result.valid).toBe(true);
  });

  it('rejects 0 (below lower bound)', () => {
    const result = validatePrnSafetyLimit(0);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('between 0.01 and 999,999.99');
    }
  });

  it('rejects negative values', () => {
    const result = validatePrnSafetyLimit(-1);
    expect(result.valid).toBe(false);
  });

  it('rejects 1000000 (above upper bound)', () => {
    const result = validatePrnSafetyLimit(1000000);
    expect(result.valid).toBe(false);
  });

  it('rejects NaN', () => {
    const result = validatePrnSafetyLimit(NaN);
    expect(result.valid).toBe(false);
  });

  it('rejects Infinity', () => {
    const result = validatePrnSafetyLimit(Infinity);
    expect(result.valid).toBe(false);
  });
});
