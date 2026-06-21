/**
 * Expand medication schedules into concrete dose slots for a calendar day.
 */

import type { MedicationProfile, MedicationSchedule, Weekday } from '@complex-patient/domain';

export interface ScheduledDoseSlot {
  medicationId: string;
  drugName: string;
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

function dosageForDay(med: MedicationProfile, day: string): string {
  if (med.schedule.kind !== 'taper') {
    return med.dosage;
  }
  const anchorDay = med.op_timestamp.slice(0, 10);
  const weekIndex = Math.floor(daysBetweenUtc(anchorDay, day) / 7);
  const phase =
    med.schedule.phases.find((entry) => entry.weekIndex === weekIndex) ??
    med.schedule.phases[med.schedule.phases.length - 1];
  return phase?.dosage ?? med.dosage;
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

function slotKey(medicationId: string, scheduledAt: string): string {
  return `${medicationId}:${scheduledAt}`;
}

/** Expand active scheduled medications into dose slots for one UTC calendar day. */
export function expandDosesForDay(
  medications: readonly MedicationProfile[],
  day: string,
): ScheduledDoseSlot[] {
  const slots: ScheduledDoseSlot[] = [];

  for (const med of medications) {
    if (med.active !== true || med.deleted === true) continue;
    if (!isScheduledOnDay(med.schedule, day, med.op_timestamp)) continue;

    const dosageLabel = dosageForDay(med, day);
    for (const time of timesForSchedule(med.schedule)) {
      slots.push({
        medicationId: med.id,
        drugName: med.drugName,
        dosageLabel,
        scheduledAt: toScheduledIso(day, time),
        timeLabel: time,
      });
    }
  }

  slots.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
  return slots;
}

export function scheduledDoseKey(medicationId: string, scheduledAt: string): string {
  return slotKey(medicationId, scheduledAt);
}

export { scheduledDoseKey as doseInstanceKey };
