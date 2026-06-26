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
  /** Optional minimum hours between PRN doses (e.g. 4 for q4h PRN). */
  minIntervalHours?: number;
}

/**
 * Medication schedule variants.
 *
 * - prn: as-needed, excluded from fixed-time scheduling (11.3, 13.2)
 * - weekly: specific days of the week (11.1)
 * - alternating: alternating days from a start date (11.1)
 * - rotating-interval: every N days where N ∈ [1, 365] (11.1, 11.4)
 * - taper: multi-week tapering up to 52 weeks (11.2, 11.4)
 */
export type MedicationSchedule =
  | { kind: 'prn'; times?: string[] }
  | { kind: 'weekly'; daysOfWeek: Weekday[]; times: string[] }
  | { kind: 'alternating'; startDate: string; times: string[] }
  | { kind: 'rotating-interval'; everyNDays: number; times: string[] }
  | { kind: 'taper'; phases: TaperPhase[] };

/**
 * One dose regimen for a medication — dosage, form, and schedule.
 * A single drug (e.g. Prazosin) may have multiple regimens (morning + bedtime).
 */
export interface DoseRegimen {
  id: string;
  /** Short label for reminders and the cabinet (e.g. "Morning", "Bedtime"). */
  label?: string;
  dosage: string;
  form: string;
  schedule: MedicationSchedule;
  prn?: PrnConfig;
}

/**
 * A full medication profile record stored in the medications vault partition.
 *
 * drugName is required (non-empty, ≤200 characters).
 * At least one regimen is required; each regimen's dosage and form are required.
 * prescribingPhysician and conditionTreated are optional (≤200 characters when provided).
 */
export interface MedicationProfile extends VaultRecord {
  drugName: string;
  /** Optional — may be empty when unknown or self-managed. */
  prescribingPhysician: string;
  /** Optional — may be empty when unknown or self-managed. */
  conditionTreated: string;
  /** Optional dosing instructions (PRN rules, substitutions, OTC, etc.). */
  notes?: string;
  active: boolean;
  regimens: DoseRegimen[];
  appearance?: MedAppearance;
  refill?: MedRefillTracking;
  /** Optional NDC or barcode string (manual entry; scan can populate later). */
  productCode?: string;
  /** RxNorm concept id — set only after user confirms a naming match. */
  rxcui?: string;
  /** Ingredient-level RxCUI for duplicate-ingredient checks. */
  ingredientRxcui?: string;
  /** Generic display name from RxNorm (e.g. Ibuprofen). */
  rxDisplayName?: string;
  /** Match confidence 0–1 when user was prompted. */
  rxMatchConfidence?: number;
  /** User confirmed the suggested RxNorm match. */
  userConfirmedRxMatch?: boolean;
  /** Version of bundled naming dataset used at match time. */
  rxnormDatasetVersion?: string;
}

/** Human-readable dosage summary across all regimens (e.g. "1mg · 2mg bedtime"). */
export function summarizeMedicationDosage(med: MedicationProfile): string {
  return med.regimens
    .map((regimen) => {
      const prefix = regimen.label?.trim();
      return prefix ? `${regimen.dosage} (${prefix})` : regimen.dosage;
    })
    .join(' · ');
}

/** Distinct forms across regimens, joined for display. */
export function summarizeMedicationForm(med: MedicationProfile): string {
  return [...new Set(med.regimens.map((regimen) => regimen.form))].join(', ');
}

/** Collect scheduled administration times from all non-PRN regimens. */
export function scheduledTimesForMedication(med: MedicationProfile): string[] {
  const times: string[] = [];
  for (const regimen of med.regimens) {
    switch (regimen.schedule.kind) {
      case 'weekly':
      case 'alternating':
      case 'rotating-interval':
        times.push(...regimen.schedule.times);
        break;
      default:
        break;
    }
  }
  return times;
}

/** True when any regimen is PRN or carries a PRN config. */
export function medicationHasPrn(med: MedicationProfile): boolean {
  return med.regimens.some(
    (regimen) => regimen.schedule.kind === 'prn' || regimen.prn !== undefined,
  );
}

export type MedEventStatus = 'pending' | 'taken' | 'skipped' | 'snoozed';

/**
 * Scheduled dose adherence record — stored in the medications vault partition.
 */
export interface MedEvent extends VaultRecord {
  medicationId: string;
  regimenId: string;
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
  /** Which PRN regimen was logged; omitted on legacy logs defaults to first PRN regimen. */
  regimenId?: string;
  amount: number;
  takenAt: string;
  override?: boolean;
  location?: LogLocation;
}
