/**
 * Shared medications UI helpers.
 */

import type {
  MedAppearance,
  MedicationProfile,
  MedicationSchedule,
  PrnConfig,
  VaultRecord,
  Weekday,
} from '@complex-patient/domain';
import { DEFAULT_MED_APPEARANCE } from '@complex-patient/med-visuals';
import { DEFAULT_DOSAGE_UNIT, formatDosageString, parseDosageString } from './dosage-units';

export function generateMedicationId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return `med-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export function defaultWeeklySchedule(): MedicationSchedule {
  return { kind: 'weekly', daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], times: ['08:00'] };
}

export function defaultPrnSchedule(): MedicationSchedule {
  return { kind: 'prn' };
}

export function normalizeMedicationLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function suggestMedicationFieldValues(
  medications: readonly MedicationProfile[],
  pick: (med: MedicationProfile) => string,
  query: string,
  limit = 8,
): string[] {
  const key = normalizeMedicationLabel(query).toLowerCase();
  const seen = new Set<string>();
  const results: string[] = [];

  for (const med of medications) {
    const label = normalizeMedicationLabel(pick(med));
    const labelKey = label.toLowerCase();
    if (!labelKey || seen.has(labelKey)) continue;
    if (!key || labelKey.includes(key)) {
      seen.add(labelKey);
      results.push(label);
      if (results.length >= limit) break;
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

export function suggestPrescribingPhysicians(
  medications: readonly MedicationProfile[],
  query: string,
  limit = 8,
): string[] {
  return suggestMedicationFieldValues(medications, (med) => med.prescribingPhysician, query, limit);
}

export function suggestConditionsTreated(
  medications: readonly MedicationProfile[],
  query: string,
  limit = 8,
): string[] {
  return suggestMedicationFieldValues(medications, (med) => med.conditionTreated, query, limit);
}

export interface MedicationDraft {
  drugName: string;
  dosageAmount: string;
  dosageUnit: string;
  form: string;
  prescribingPhysician: string;
  conditionTreated: string;
  scheduleKind: MedicationSchedule['kind'];
  weeklyDays: Weekday[];
  weeklyTimes: string;
  alternatingStartDate: string;
  rotatingEveryNDays: string;
  taperPhases: string;
  /** Max total amount allowed in 24h (same unit as dosage). Used when schedule is PRN. */
  prnSafetyLimit: string;
  appearance: MedAppearance;
  quantityOnHand: string;
  lowStockThreshold: string;
  productCode: string;
}

export function emptyMedicationDraft(): MedicationDraft {
  return {
    drugName: '',
    dosageAmount: '',
    dosageUnit: DEFAULT_DOSAGE_UNIT,
    form: 'tablet',
    prescribingPhysician: '',
    conditionTreated: '',
    scheduleKind: 'weekly',
    weeklyDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    weeklyTimes: '08:00',
    alternatingStartDate: new Date().toISOString().slice(0, 10),
    rotatingEveryNDays: '1',
    taperPhases: '50mg\n25mg',
    prnSafetyLimit: '',
    appearance: { ...DEFAULT_MED_APPEARANCE },
    quantityOnHand: '',
    lowStockThreshold: '',
    productCode: '',
  };
}

export function draftFromProfile(profile: MedicationProfile): MedicationDraft {
  const draft = emptyMedicationDraft();
  draft.drugName = profile.drugName;
  const parsedDosage = parseDosageString(profile.dosage);
  draft.dosageAmount = parsedDosage.amount;
  draft.dosageUnit = parsedDosage.unit;
  draft.form = profile.form;
  draft.prescribingPhysician = profile.prescribingPhysician;
  draft.conditionTreated = profile.conditionTreated;
  draft.appearance = profile.appearance ?? { ...DEFAULT_MED_APPEARANCE };
  draft.productCode = profile.productCode ?? '';
  draft.quantityOnHand = profile.refill?.quantityOnHand?.toString() ?? '';
  draft.lowStockThreshold = profile.refill?.lowStockThreshold?.toString() ?? '';
  draft.scheduleKind = profile.schedule.kind;

  if (profile.schedule.kind === 'weekly') {
    draft.weeklyDays = [...profile.schedule.daysOfWeek];
    draft.weeklyTimes = profile.schedule.times.join(', ');
  } else if (profile.schedule.kind === 'alternating') {
    draft.alternatingStartDate = profile.schedule.startDate.slice(0, 10);
    draft.weeklyTimes = profile.schedule.times.join(', ');
  } else if (profile.schedule.kind === 'rotating-interval') {
    draft.rotatingEveryNDays = String(profile.schedule.everyNDays);
    draft.weeklyTimes = profile.schedule.times.join(', ');
  } else if (profile.schedule.kind === 'taper') {
    draft.taperPhases = profile.schedule.phases.map((phase) => phase.dosage).join('\n');
  } else if (profile.schedule.kind === 'prn' && profile.schedule.times?.length) {
    draft.weeklyTimes = profile.schedule.times.join(', ');
  }

  if (profile.prn) {
    draft.prnSafetyLimit = String(profile.prn.safetyLimit24h);
  }

  return draft;
}

export function draftDoseAmount(draft: Pick<MedicationDraft, 'dosageAmount'>): number {
  const parsed = Number.parseFloat(draft.dosageAmount.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function buildPrnConfigFromDraft(draft: MedicationDraft): PrnConfig {
  const doseAmount = draftDoseAmount(draft);
  const parsedLimit = Number.parseFloat(draft.prnSafetyLimit.trim());
  const defaultLimit = doseAmount * 4;
  return {
    doseAmount,
    doseUnit: draft.dosageUnit.trim() || DEFAULT_DOSAGE_UNIT,
    safetyLimit24h: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit,
  };
}

export function buildScheduleFromDraft(draft: MedicationDraft): MedicationSchedule {
  const times = draft.weeklyTimes
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  switch (draft.scheduleKind) {
    case 'prn':
      return times.length ? { kind: 'prn', times } : { kind: 'prn' };
    case 'alternating':
      return { kind: 'alternating', startDate: draft.alternatingStartDate, times: times.length ? times : ['08:00'] };
    case 'rotating-interval':
      return {
        kind: 'rotating-interval',
        everyNDays: Math.min(30, Math.max(1, Number.parseInt(draft.rotatingEveryNDays, 10) || 1)),
        times: times.length ? times : ['08:00'],
      };
    case 'taper':
      return {
        kind: 'taper',
        phases: draft.taperPhases
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((dosage, weekIndex) => ({ weekIndex, dosage })),
      };
    case 'weekly':
    default:
      return {
        kind: 'weekly',
        daysOfWeek: draft.weeklyDays.length ? draft.weeklyDays : ['MON'],
        times: times.length ? times : ['08:00'],
      };
  }
}

export function buildProfileFromDraft(draft: MedicationDraft, existing?: MedicationProfile): MedicationProfile {
  const now = new Date().toISOString();
  const schedule = buildScheduleFromDraft(draft);
  const profile: MedicationProfile = {
    id: existing?.id ?? generateMedicationId(),
    op_timestamp: existing?.op_timestamp ?? now,
    drugName: draft.drugName.trim(),
    dosage: formatDosageString(draft.dosageAmount, draft.dosageUnit).trim(),
    form: draft.form.trim(),
    prescribingPhysician: draft.prescribingPhysician.trim(),
    conditionTreated: draft.conditionTreated.trim(),
    active: existing?.active ?? true,
    schedule,
    appearance: draft.appearance,
  };

  if (draft.scheduleKind === 'prn') {
    profile.prn = buildPrnConfigFromDraft(draft);
  }

  if (draft.quantityOnHand.trim() || draft.lowStockThreshold.trim()) {
    profile.refill = {
      quantityOnHand: draft.quantityOnHand.trim() ? Number.parseFloat(draft.quantityOnHand) : undefined,
      lowStockThreshold: draft.lowStockThreshold.trim()
        ? Number.parseFloat(draft.lowStockThreshold)
        : undefined,
    };
  }

  if (draft.productCode.trim()) {
    profile.productCode = draft.productCode.trim();
  }

  return profile;
}

export function mergeMedicationRecord(current: VaultRecord[], profile: MedicationProfile): VaultRecord[] {
  const index = current.findIndex((record) => record.id === profile.id);
  if (index === -1) {
    return [...current, profile];
  }
  return current.map((record) => (record.id === profile.id ? profile : record));
}
