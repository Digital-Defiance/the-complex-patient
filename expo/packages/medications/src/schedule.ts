/**
 * Expand medication schedules into concrete dose slots for a calendar day.
 */

import type { DoseRegimen, MedicationProfile, MedicationSchedule, Weekday } from '@complex-patient/domain';

export interface ScheduledDoseSlot {
  medicationId: string;
  regimenId: string;
  drugName: string;
  regimenLabel?: string;
  dosageLabel: string;
  scheduledAt: string;
  timeLabel: string;
}

const WEEKDAY_INDEX: Record<Weekday, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function utcDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function weekdayForDay(day: string): Weekday {
  const index = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  const entries = Object.entries(WEEKDAY_INDEX) as [Weekday, number][];
  return entries.find(([, value]) => value === index)?.[0] ?? 'MON';
}

function daysBetweenUtc(startDay: string, endDay: string): number {
  return Math.round((utcDayStartMs(endDay) - utcDayStartMs(startDay)) / (24 * 60 * 60 * 1000));
}

function isScheduledOnDay(schedule: MedicationSchedule, day: string, anchorDay: string): boolean {
  switch (schedule.kind) {
    case 'prn':
      return false;
    case 'taper':
      return true;
    case 'weekly':
      return schedule.daysOfWeek.includes(weekdayForDay(day));
    case 'alternating': {
      const delta = daysBetweenUtc(schedule.startDate.slice(0, 10), day);
      return delta >= 0 && delta % 2 === 0;
    }
    case 'rotating-interval': {
      const delta = daysBetweenUtc(anchorDay.slice(0, 10), day);
      if (delta < 0) return false;
      return delta % schedule.everyNDays === 0;
    }
    default:
      return false;
  }
}

function timesForSchedule(schedule: MedicationSchedule): readonly string[] {
  switch (schedule.kind) {
    case 'weekly':
    case 'alternating':
    case 'rotating-interval':
      return schedule.times;
    case 'taper':
      return ['08:00'];
    default:
      return [];
  }
}

function dosageForDay(regimen: DoseRegimen, day: string, anchorDay: string): string {
  if (regimen.schedule.kind !== 'taper') {
    return regimen.dosage;
  }
  const weekIndex = Math.floor(daysBetweenUtc(anchorDay, day) / 7);
  const phase =
    regimen.schedule.phases.find((entry) => entry.weekIndex === weekIndex) ??
    regimen.schedule.phases[regimen.schedule.phases.length - 1];
  return phase?.dosage ?? regimen.dosage;
}

function toScheduledIso(day: string, time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    return `${day}T08:00:00.000Z`;
  }
  const hours = match[1].padStart(2, '0');
  const minutes = match[2];
  return `${day}T${hours}:${minutes}:00.000Z`;
}

function slotKey(medicationId: string, regimenId: string, scheduledAt: string): string {
  return `${medicationId}:${regimenId}:${scheduledAt}`;
}

/** Expand active scheduled medications into dose slots for one UTC calendar day. */
export function expandDosesForDay(
  medications: readonly MedicationProfile[],
  day: string,
): ScheduledDoseSlot[] {
  const slots: ScheduledDoseSlot[] = [];

  for (const med of medications) {
    if (med.active !== true || med.deleted === true) continue;

    for (const regimen of med.regimens) {
      if (!isScheduledOnDay(regimen.schedule, day, med.op_timestamp)) continue;

      const dosageLabel = dosageForDay(regimen, day, med.op_timestamp);
      for (const time of timesForSchedule(regimen.schedule)) {
        slots.push({
          medicationId: med.id,
          regimenId: regimen.id,
          drugName: med.drugName,
          regimenLabel: regimen.label,
          dosageLabel,
          scheduledAt: toScheduledIso(day, time),
          timeLabel: time,
        });
      }
    }
  }

  slots.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
  return slots;
}

export function scheduledDoseKey(
  medicationId: string,
  regimenId: string,
  scheduledAt: string,
): string {
  return slotKey(medicationId, regimenId, scheduledAt);
}

export { scheduledDoseKey as doseInstanceKey };
