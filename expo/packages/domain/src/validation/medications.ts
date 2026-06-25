/**
 * Medication validation functions.
 *
 * Requirements: 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 13.3, 13.4
 */

import type { DoseRegimen, MedicationProfile, MedicationSchedule, PrnConfig } from '../medications';

/**
 * Per-field error for profile validation.
 * The `field` identifies which profile field failed validation.
 */
export interface ProfileFieldError {
  field:
    | 'drugName'
    | 'dosage'
    | 'form'
    | 'prescribingPhysician'
    | 'conditionTreated'
    | 'notes'
    | 'regimens';
  regimenIndex?: number;
  message: string;
}

/**
 * Result of profile validation.
 */
export type ProfileValidationResult =
  | { valid: true }
  | { valid: false; errors: ProfileFieldError[] };

/**
 * Result of schedule validation.
 */
export type ScheduleValidationResult =
  | { valid: true }
  | { valid: false; message: string };

/**
 * Result of PRN safety limit validation.
 */
export type PrnLimitValidationResult =
  | { valid: true }
  | { valid: false; message: string };

const OPTIONAL_PROFILE_FIELDS = ['prescribingPhysician', 'conditionTreated', 'notes'] as const;

function validateTextField(
  field: ProfileFieldError['field'],
  value: unknown,
  required: boolean,
  regimenIndex?: number,
): ProfileFieldError | null {
  if (value === undefined || value === null) {
    if (required) {
      return { field, regimenIndex, message: `${field} is required and must be non-empty` };
    }
    return null;
  }

  if (typeof value !== 'string') {
    return { field, regimenIndex, message: `${field} must be a string` };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (required) {
      return { field, regimenIndex, message: `${field} is required and must be non-empty` };
    }
    return null;
  }

  if (trimmed.length > 200) {
    return { field, regimenIndex, message: `${field} must be at most 200 characters` };
  }

  return null;
}

/**
 * Validates a single dose regimen.
 */
export function validateDoseRegimen(regimen: DoseRegimen, index: number): ProfileFieldError[] {
  const errors: ProfileFieldError[] = [];

  const dosageError = validateTextField('dosage', regimen.dosage, true, index);
  if (dosageError) errors.push(dosageError);

  const formError = validateTextField('form', regimen.form, true, index);
  if (formError) errors.push(formError);

  if (typeof regimen.label === 'string' && regimen.label.trim().length > 200) {
    errors.push({
      field: 'regimens',
      regimenIndex: index,
      message: 'Regimen label must be at most 200 characters',
    });
  }

  return errors;
}

/**
 * Validates medication profile text fields and regimens.
 */
export function validateMedicationProfile(
  profile: Pick<
    MedicationProfile,
    'drugName' | 'prescribingPhysician' | 'conditionTreated' | 'notes' | 'regimens'
  >,
): ProfileValidationResult {
  const errors: ProfileFieldError[] = [];

  const drugNameError = validateTextField('drugName', profile.drugName, true);
  if (drugNameError) errors.push(drugNameError);

  for (const field of OPTIONAL_PROFILE_FIELDS) {
    const error = validateTextField(field, profile[field], false);
    if (error) errors.push(error);
  }

  if (!Array.isArray(profile.regimens) || profile.regimens.length === 0) {
    errors.push({ field: 'regimens', message: 'At least one dose regimen is required' });
  } else {
    profile.regimens.forEach((regimen, index) => {
      errors.push(...validateDoseRegimen(regimen, index));
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Validates a medication schedule.
 *
 * - weekly: must have at least one selected day (11.4)
 * - rotating-interval: everyNDays must be an integer in [1, 365] (11.4)
 * - taper: every phase must have a non-empty dosage string (11.2, 11.4)
 * - prn / alternating: no additional validation beyond structure
 */
export function validateMedicationSchedule(schedule: MedicationSchedule): ScheduleValidationResult {
  switch (schedule.kind) {
    case 'weekly':
      if (!schedule.daysOfWeek || schedule.daysOfWeek.length === 0) {
        return { valid: false, message: 'Weekly schedule must have at least one selected day' };
      }
      return { valid: true };

    case 'rotating-interval': {
      const n = schedule.everyNDays;
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return {
          valid: false,
          message: 'Rotating interval must be an integer between 1 and 365',
        };
      }
      return { valid: true };
    }

    case 'taper':
      if (!schedule.phases || schedule.phases.length === 0) {
        return { valid: false, message: 'Taper schedule must have at least one phase' };
      }
      for (let i = 0; i < schedule.phases.length; i++) {
        const phase = schedule.phases[i];
        if (typeof phase.dosage !== 'string' || phase.dosage.length === 0) {
          return { valid: false, message: `Taper phase ${i} must have a non-empty dosage` };
        }
      }
      return { valid: true };

    case 'prn':
    case 'alternating':
      return { valid: true };

    default:
      return { valid: false, message: 'Unknown schedule kind' };
  }
}

/**
 * Validates PRN configuration including optional minimum interval.
 */
export function validatePrnConfig(prn: PrnConfig): PrnLimitValidationResult {
  const limitResult = validatePrnSafetyLimit(prn.safetyLimit24h);
  if (!limitResult.valid) {
    return limitResult;
  }

  if (prn.minIntervalHours !== undefined) {
    if (
      typeof prn.minIntervalHours !== 'number' ||
      !Number.isFinite(prn.minIntervalHours) ||
      prn.minIntervalHours < 0.25 ||
      prn.minIntervalHours > 168
    ) {
      return {
        valid: false,
        message: 'Minimum interval must be between 0.25 and 168 hours',
      };
    }
  }

  return { valid: true };
}

/**
 * Validates the PRN 24-hour safety limit.
 *
 * safetyLimit24h must be in [0.01, 999999.99] (13.3, 13.4).
 * Out-of-range values are rejected.
 */
export function validatePrnSafetyLimit(safetyLimit24h: number): PrnLimitValidationResult {
  if (typeof safetyLimit24h !== 'number' || !Number.isFinite(safetyLimit24h)) {
    return { valid: false, message: 'Safety limit must be a finite number' };
  }
  if (safetyLimit24h < 0.01 || safetyLimit24h > 999999.99) {
    return { valid: false, message: 'Safety limit must be between 0.01 and 999,999.99' };
  }
  return { valid: true };
}
