/**
 * Symptom, Condition, and Flare domain models.
 *
 * Requirements: 15.1, 15.3, 15.4, 15.5, 15.6, 16.1, 16.3, 17.1, 17.2
 */

import type { VaultRecord } from './types';

/**
 * Time units for symptom duration measurement.
 */
export type TimeUnit = 'minutes' | 'hours' | 'days' | 'weeks';

/**
 * A user-defined diagnosis or syndrome (e.g., POTS, MCAS, EDS).
 */
export interface Condition extends VaultRecord {
  name: string;
}

/**
 * A validated symptom entry stored in the symptoms vault partition.
 *
 * - symptomType and systemicLocation must be non-empty (15.1, 15.3)
 * - severity must be an integer 1–10 inclusive (15.1, 15.4)
 * - duration must have a positive value with a valid TimeUnit (15.1)
 * - notes must be ≤2000 characters (15.5)
 * - active determines eligibility for flare batch selection (17.1)
 */
export interface SymptomEntry extends VaultRecord {
  symptomType: string;
  systemicLocation: string;
  severity: number;
  duration: { value: number; unit: TimeUnit };
  notes: string;
  active: boolean;
}

/**
 * An unsaved symptom draft retained on validation rejection (15.6).
 * All fields are optional since they represent partially-entered user input.
 */
export interface SymptomDraft {
  symptomType?: string;
  systemicLocation?: string;
  severity?: number;
  duration?: { value?: number; unit?: TimeUnit };
  notes?: string;
  active?: boolean;
}

/**
 * Links a symptom to conditions and/or medications.
 *
 * - conditionIds: 1–50 existing conditions (16.1, 16.2)
 * - medicationIds: 1–50 medications when flagged adverse (16.3)
 */
export interface Association extends VaultRecord {
  symptomId: string;
  conditionIds: string[];
  medicationIds: string[];
}

/**
 * A batch flare-up event grouping multiple active symptoms with a trigger.
 *
 * - symptomIds: 2–50 active symptoms (17.1, 17.4)
 * - trigger: ≤500 characters (17.2)
 */
export interface FlareUp extends VaultRecord {
  symptomIds: string[];
  trigger: string;
}
