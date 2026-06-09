/**
 * Validation functions for symptom, association, and flare domain models.
 *
 * Requirements: 15.1, 15.3, 15.4, 15.5, 16.1, 16.3, 17.1, 17.2
 */

import type { TimeUnit } from '../symptoms';

/**
 * Per-field validation error with a field identifier and a human-readable message.
 */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Result of validating a symptom entry.
 */
export type SymptomValidationResult =
  | { valid: true }
  | { valid: false; errors: FieldError[] };

/**
 * Result of validating an association.
 */
export type AssociationValidationResult =
  | { valid: true }
  | { valid: false; errors: FieldError[] };

/**
 * Result of validating a flare-up.
 */
export type FlareValidationResult =
  | { valid: true }
  | { valid: false; errors: FieldError[] };

const VALID_TIME_UNITS: TimeUnit[] = ['minutes', 'hours', 'days', 'weeks'];

/**
 * Validates a symptom entry input.
 *
 * Rules:
 * - symptomType must be non-empty (15.1, 15.3)
 * - systemicLocation must be non-empty (15.1, 15.3)
 * - severity must be an integer from 1 to 10 inclusive (15.1, 15.4)
 * - duration.value must be positive and duration.unit must be a valid TimeUnit (15.1)
 * - notes must be ≤2000 characters (15.5)
 *
 * Returns per-field error messages identifying each invalid field.
 */
export function validateSymptomEntry(input: {
  symptomType: unknown;
  systemicLocation: unknown;
  severity: unknown;
  duration: unknown;
  notes: unknown;
}): SymptomValidationResult {
  const errors: FieldError[] = [];

  // symptomType: non-empty string
  if (typeof input.symptomType !== 'string' || input.symptomType.trim() === '') {
    errors.push({ field: 'symptomType', message: 'Symptom type is required' });
  }

  // systemicLocation: non-empty string
  if (typeof input.systemicLocation !== 'string' || input.systemicLocation.trim() === '') {
    errors.push({ field: 'systemicLocation', message: 'Systemic location is required' });
  }

  // severity: integer in [1, 10]
  if (
    typeof input.severity !== 'number' ||
    !Number.isInteger(input.severity) ||
    input.severity < 1 ||
    input.severity > 10
  ) {
    errors.push({
      field: 'severity',
      message: 'Severity must be an integer between 1 and 10',
    });
  }

  // duration: positive value with valid unit
  if (
    input.duration == null ||
    typeof input.duration !== 'object'
  ) {
    errors.push({ field: 'duration', message: 'Duration is required' });
  } else {
    const dur = input.duration as { value?: unknown; unit?: unknown };
    const hasValidValue = typeof dur.value === 'number' && dur.value > 0 && Number.isFinite(dur.value);
    const hasValidUnit = typeof dur.unit === 'string' && VALID_TIME_UNITS.includes(dur.unit as TimeUnit);

    if (!hasValidValue) {
      errors.push({ field: 'duration.value', message: 'Duration must be a positive number' });
    }
    if (!hasValidUnit) {
      errors.push({ field: 'duration.unit', message: 'Duration unit must be one of: minutes, hours, days, weeks' });
    }
  }

  // notes: ≤2000 characters
  if (typeof input.notes === 'string' && input.notes.length > 2000) {
    errors.push({ field: 'notes', message: 'Notes must not exceed 2000 characters' });
  }

  if (errors.length === 0) {
    return { valid: true };
  }
  return { valid: false, errors };
}

/**
 * Validates an association's cardinality constraints.
 *
 * Rules:
 * - conditionIds must have 1–50 entries (16.1)
 * - medicationIds must have 1–50 entries when present/non-empty (16.3)
 *
 * Returns per-field error messages.
 */
export function validateAssociation(input: {
  conditionIds: unknown;
  medicationIds: unknown;
}): AssociationValidationResult {
  const errors: FieldError[] = [];

  // conditionIds: array with 1–50 entries
  if (!Array.isArray(input.conditionIds)) {
    errors.push({ field: 'conditionIds', message: 'Conditions must be an array' });
  } else if (input.conditionIds.length < 1) {
    errors.push({ field: 'conditionIds', message: 'At least 1 condition is required' });
  } else if (input.conditionIds.length > 50) {
    errors.push({ field: 'conditionIds', message: 'No more than 50 conditions are allowed' });
  }

  // medicationIds: 1–50 entries when present/non-empty
  if (Array.isArray(input.medicationIds) && input.medicationIds.length > 0) {
    if (input.medicationIds.length > 50) {
      errors.push({ field: 'medicationIds', message: 'No more than 50 medications are allowed' });
    }
  } else if (input.medicationIds != null && !Array.isArray(input.medicationIds)) {
    errors.push({ field: 'medicationIds', message: 'Medications must be an array' });
  }

  if (errors.length === 0) {
    return { valid: true };
  }
  return { valid: false, errors };
}

/**
 * Validates a flare-up event.
 *
 * Rules:
 * - symptomIds must have 2–50 entries (17.1, 17.4)
 * - trigger must be ≤500 characters (17.2)
 *
 * Returns per-field error messages.
 */
export function validateFlareUp(input: {
  symptomIds: unknown;
  trigger: unknown;
}): FlareValidationResult {
  const errors: FieldError[] = [];

  // symptomIds: 2–50 entries
  if (!Array.isArray(input.symptomIds)) {
    errors.push({ field: 'symptomIds', message: 'Symptom IDs must be an array' });
  } else if (input.symptomIds.length < 2) {
    errors.push({ field: 'symptomIds', message: 'At least 2 active symptoms are required for a flare-up' });
  } else if (input.symptomIds.length > 50) {
    errors.push({ field: 'symptomIds', message: 'No more than 50 symptoms are allowed in a flare-up' });
  }

  // trigger: ≤500 chars
  if (typeof input.trigger === 'string' && input.trigger.length > 500) {
    errors.push({ field: 'trigger', message: 'Trigger description must not exceed 500 characters' });
  }

  if (errors.length === 0) {
    return { valid: true };
  }
  return { valid: false, errors };
}
