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
 * Time-of-day blocks for the adaptive medications view (14.1, 14.3).
 */
export type TimeBlock = 'Morning' | 'Midday' | 'Evening' | 'Night/Bedtime';

/** Parametric pill shape for the medications cabinet and today queue. */
export type MedPillShape = 'capsule' | 'round' | 'oval' | 'tablet';

/** User-selected pill appearance (no external image assets). */
export interface MedAppearance {
  shape: MedPillShape;
  colorPrimary: string;
  colorSecondary?: string;
}

/** Optional refill tracking on a medication profile. */
export interface MedRefillTracking {
  quantityOnHand?: number;
  /** Alert when quantityOnHand falls to or below this value. */
  lowStockThreshold?: number;
}

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
  | { kind: 'prn'; times?: string[] }
  | { kind: 'weekly'; daysOfWeek: Weekday[]; times: string[] }
  | { kind: 'alternating'; startDate: string; times: string[] }
  | { kind: 'rotating-interval'; everyNDays: number; times: string[] }
  | { kind: 'taper'; phases: TaperPhase[] };

/**
 * A full medication profile record stored in the medications vault partition.
 *
 * drugName, dosage, and form are required (non-empty, ≤200 characters).
 * prescribingPhysician and conditionTreated are optional (≤200 characters when provided).
 */
export interface MedicationProfile extends VaultRecord {
  drugName: string;
  dosage: string;
  form: string;
  /** Optional — may be empty when unknown or self-managed. */
  prescribingPhysician: string;
  /** Optional — may be empty when unknown or self-managed. */
  conditionTreated: string;
  active: boolean;
  schedule: MedicationSchedule;
  prn?: PrnConfig;
  appearance?: MedAppearance;
  refill?: MedRefillTracking;
  /** Optional NDC or barcode string (manual entry; scan can populate later). */
  productCode?: string;
}

export type MedEventStatus = 'pending' | 'taken' | 'skipped' | 'snoozed';

/**
 * Scheduled dose adherence record — stored in the medications vault partition.
 */
export interface MedEvent extends VaultRecord {
  medicationId: string;
  scheduledAt: string;
  takenAt: string | null;
  status?: MedEventStatus;
  skippedReason?: string;
  snoozedUntil?: string;
}

/**
 * Optional approximate location captured when logging a PRN dose (rounded WGS84).
 * Stored in the encrypted vault and synced cross-device; used for weather overlays.
 */
export interface LogLocation {
  latitude: number;
  longitude: number;
  capturedAt: string;
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
  location?: LogLocation;
}
