/**
 * Medication domain models.
 *
 * Requirements: 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 13.3, 13.4
 */

import type { VaultRecord } from './types';

/**
 * Days of the week for weekly scheduling.
 */
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

/**
 * Time-of-day blocks for the adaptive polypharmacy view (14.1, 14.3).
 */
export type TimeBlock = 'Morning' | 'Midday' | 'Evening' | 'Night/Bedtime';

/**
 * A single phase of a tapering schedule.
 * Each phase specifies the week index and the dosage for that week.
 * dosage is required and must be non-empty (11.2, 11.4).
 */
export interface TaperPhase {
  weekIndex: number;
  dosage: string;
}

/**
 * PRN (as-needed) medication configuration.
 * safetyLimit24h must be in [0.01, 999999.99] (13.3, 13.4).
 */
export interface PrnConfig {
  doseAmount: number;
  doseUnit: string;
  safetyLimit24h: number;
}

/**
 * Medication schedule variants.
 *
 * - prn: as-needed, excluded from fixed-time scheduling (11.3, 13.2)
 * - weekly: specific days of the week (11.1)
 * - alternating: alternating days from a start date (11.1)
 * - rotating-interval: every N days where N ∈ [1, 30] (11.1, 11.4)
 * - taper: multi-week tapering up to 52 weeks (11.2, 11.4)
 */
export type MedicationSchedule =
  | { kind: 'prn' }
  | { kind: 'weekly'; daysOfWeek: Weekday[]; times: string[] }
  | { kind: 'alternating'; startDate: string; times: string[] }
  | { kind: 'rotating-interval'; everyNDays: number; times: string[] }
  | { kind: 'taper'; phases: TaperPhase[] };

/**
 * A full medication profile record stored in the medications vault partition.
 *
 * All five text fields (drugName, dosage, form, prescribingPhysician, conditionTreated)
 * must be non-empty and ≤200 characters (10.1, 10.2).
 */
export interface MedicationProfile extends VaultRecord {
  drugName: string;
  dosage: string;
  form: string;
  prescribingPhysician: string;
  conditionTreated: string;
  active: boolean;
  schedule: MedicationSchedule;
  prn?: PrnConfig;
}

/**
 * A PRN dose log entry.
 * Tracks individual as-needed doses for trailing-24h cumulative checks (13.5, 13.6).
 */
export interface PrnLog extends VaultRecord {
  medicationId: string;
  amount: number;
  takenAt: string;
  override?: boolean;
}
