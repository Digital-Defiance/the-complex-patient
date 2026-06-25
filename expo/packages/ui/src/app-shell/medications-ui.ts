/**
 * Shared medications UI helpers.
 */

import type {
  DoseRegimen,
  MedAppearance,
  MedicationProfile,
  MedicationSchedule,
  PrnConfig,
  VaultRecord,
  Weekday,
} from '@complex-patient/domain';
import { DEFAULT_MED_APPEARANCE } from '@complex-patient/med-visuals';
import { DEFAULT_DOSAGE_UNIT, formatDosageString, parseDosageString } from './dosage-units';

export const MEDICATION_FORMS = [
  'tablet',
  'capsule',
  'liquid',
  'injection',
  'patch',
  'inhaler',
  'spray',
  'cream',
  'drops',
  'suppository',
  'powder',
  'other',
] as const;

export type MedicationFormOption = (typeof MEDICATION_FORMS)[number];

export const REGIMEN_LABEL_PRESETS = [
  { label: 'Morning', times: '08:00' },
  { label: 'Midday', times: '12:00' },
  { label: 'Evening', times: '18:00' },
  { label: 'Bedtime', times: '22:00' },
] as const;

export function generateMedicationId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return `med-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function generateRegimenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return `reg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export interface RegimenDraft {
  id: string;
  label: string;
  dosageAmount: string;
  dosageUnit: string;
  form: string;
  scheduleKind: MedicationSchedule['kind'];
  weeklyDays: Weekday[];
  weeklyTimes: string;
  alternatingStartDate: string;
  rotatingEveryNDays: string;
  taperPhases: string;
  prnSafetyLimit: string;
  prnMinIntervalHours: string;
}

export interface MedicationDraft {
  drugName: string;
  prescribingPhysician: string;
  conditionTreated: string;
  notes: string;
  regimens: RegimenDraft[];
  appearance: MedAppearance;
  quantityOnHand: string;
  lowStockThreshold: string;
  productCode: string;
}

export function emptyRegimenDraft(preset?: { label?: string; times?: string }): RegimenDraft {
  return {
    id: generateRegimenId(),
    label: preset?.label ?? '',
    dosageAmount: '',
    dosageUnit: DEFAULT_DOSAGE_UNIT,
    form: 'tablet',
    scheduleKind: 'weekly',
    weeklyDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    weeklyTimes: preset?.times ?? '08:00',
    alternatingStartDate: new Date().toISOString().slice(0, 10),
    rotatingEveryNDays: '1',
    taperPhases: '50mg\n25mg',
    prnSafetyLimit: '',
    prnMinIntervalHours: '',
  };
}

export function emptyMedicationDraft(): MedicationDraft {
  return {
    drugName: '',
    prescribingPhysician: '',
    conditionTreated: '',
    notes: '',
    regimens: [emptyRegimenDraft()],
    appearance: { ...DEFAULT_MED_APPEARANCE },
    quantityOnHand: '',
    lowStockThreshold: '',
    productCode: '',
  };
}

export function regimenDraftFromRegimen(regimen: DoseRegimen): RegimenDraft {
  const draft = emptyRegimenDraft();
  draft.id = regimen.id;
  draft.label = regimen.label ?? '';
  const parsedDosage = parseDosageString(regimen.dosage);
  draft.dosageAmount = parsedDosage.amount;
  draft.dosageUnit = parsedDosage.unit;
  draft.form = regimen.form;
  draft.scheduleKind = regimen.schedule.kind;

  if (regimen.schedule.kind === 'weekly') {
    draft.weeklyDays = [...regimen.schedule.daysOfWeek];
    draft.weeklyTimes = regimen.schedule.times.join(', ');
  } else if (regimen.schedule.kind === 'alternating') {
    draft.alternatingStartDate = regimen.schedule.startDate.slice(0, 10);
    draft.weeklyTimes = regimen.schedule.times.join(', ');
  } else if (regimen.schedule.kind === 'rotating-interval') {
    draft.rotatingEveryNDays = String(regimen.schedule.everyNDays);
    draft.weeklyTimes = regimen.schedule.times.join(', ');
  } else if (regimen.schedule.kind === 'taper') {
    draft.taperPhases = regimen.schedule.phases.map((phase) => phase.dosage).join('\n');
  } else if (regimen.schedule.kind === 'prn' && regimen.schedule.times?.length) {
    draft.weeklyTimes = regimen.schedule.times.join(', ');
  }

  if (regimen.prn) {
    draft.prnSafetyLimit = String(regimen.prn.safetyLimit24h);
    draft.prnMinIntervalHours =
      regimen.prn.minIntervalHours !== undefined ? String(regimen.prn.minIntervalHours) : '';
  }

  return draft;
}

export function draftFromProfile(profile: MedicationProfile): MedicationDraft {
  return {
    drugName: profile.drugName,
    prescribingPhysician: profile.prescribingPhysician,
    conditionTreated: profile.conditionTreated,
    notes: profile.notes ?? '',
    regimens: profile.regimens.map(regimenDraftFromRegimen),
    appearance: profile.appearance ?? { ...DEFAULT_MED_APPEARANCE },
    quantityOnHand: profile.refill?.quantityOnHand?.toString() ?? '',
    lowStockThreshold: profile.refill?.lowStockThreshold?.toString() ?? '',
    productCode: profile.productCode ?? '',
  };
}

export function draftDoseAmount(draft: Pick<RegimenDraft, 'dosageAmount'>): number {
  const parsed = Number.parseFloat(draft.dosageAmount.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function buildPrnConfigFromDraft(draft: RegimenDraft): PrnConfig {
  const doseAmount = draftDoseAmount(draft);
  const parsedLimit = Number.parseFloat(draft.prnSafetyLimit.trim());
  const defaultLimit = doseAmount * 4;
  const parsedInterval = Number.parseFloat((draft.prnMinIntervalHours ?? '').trim());
  const config: PrnConfig = {
    doseAmount,
    doseUnit: draft.dosageUnit.trim() || DEFAULT_DOSAGE_UNIT,
    safetyLimit24h: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit,
  };
  if (Number.isFinite(parsedInterval) && parsedInterval > 0) {
    config.minIntervalHours = parsedInterval;
  }
  return config;
}

export function buildScheduleFromDraft(draft: RegimenDraft): MedicationSchedule {
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
        everyNDays: Math.min(365, Math.max(1, Number.parseInt(draft.rotatingEveryNDays, 10) || 1)),
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

export function buildRegimenFromDraft(draft: RegimenDraft): DoseRegimen {
  const schedule = buildScheduleFromDraft(draft);
  const regimen: DoseRegimen = {
    id: draft.id,
    dosage: formatDosageString(draft.dosageAmount, draft.dosageUnit).trim(),
    form: draft.form.trim(),
    schedule,
  };
  const label = draft.label.trim();
  if (label) {
    regimen.label = label;
  }
  if (draft.scheduleKind === 'prn') {
    regimen.prn = buildPrnConfigFromDraft(draft);
  }
  return regimen;
}

export function buildProfileFromDraft(draft: MedicationDraft, existing?: MedicationProfile): MedicationProfile {
  const now = new Date().toISOString();
  const profile: MedicationProfile = {
    id: existing?.id ?? generateMedicationId(),
    op_timestamp: existing?.op_timestamp ?? now,
    drugName: draft.drugName.trim(),
    prescribingPhysician: draft.prescribingPhysician.trim(),
    conditionTreated: draft.conditionTreated.trim(),
    active: existing?.active ?? true,
    regimens: draft.regimens.map(buildRegimenFromDraft),
    appearance: draft.appearance,
  };

  const notes = draft.notes.trim();
  if (notes) {
    profile.notes = notes;
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

/** @deprecated Use RegimenDraft — kept for ScheduleEditor prop typing during migration. */
export type MedicationDraftScheduleFields = RegimenDraft;
