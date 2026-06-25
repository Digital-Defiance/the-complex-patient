/**
 * Today queue — scheduled doses + PRN medications with adherence state.
 */

import type { MedEvent, MedicationProfile } from '@complex-patient/domain';
import { medicationHasPrn } from '@complex-patient/domain';
import { expandDosesForDay, type ScheduledDoseSlot } from './schedule';
import { scheduledDoseKey } from './schedule';

export type TodayDoseStatus = 'due' | 'taken' | 'skipped' | 'snoozed' | 'missed';

export interface TodayScheduledDose extends ScheduledDoseSlot {
  status: TodayDoseStatus;
  medEventId: string | null;
  skippedReason?: string;
  snoozedUntil?: string;
}

export interface TodayPrnRegimen {
  medication: MedicationProfile;
  regimenId: string;
  label?: string;
  dosage: string;
}

export interface TodayQueue {
  day: string;
  scheduled: TodayScheduledDose[];
  prn: TodayPrnRegimen[];
}

function resolveStatus(event: MedEvent | undefined, nowMs: number): TodayDoseStatus {
  if (!event) {
    return 'due';
  }
  if (event.takenAt) {
    return 'taken';
  }
  if (event.snoozedUntil && Date.parse(event.snoozedUntil) > nowMs) {
    return 'snoozed';
  }
  if (event.status === 'skipped' || event.skippedReason) {
    return 'skipped';
  }
  if (Date.parse(event.scheduledAt) < nowMs - 60 * 60 * 1000) {
    return 'missed';
  }
  return 'due';
}

function findEventForSlot(
  events: readonly MedEvent[],
  slot: ScheduledDoseSlot,
): MedEvent | undefined {
  const key = scheduledDoseKey(slot.medicationId, slot.regimenId, slot.scheduledAt);
  return events.find(
    (event) =>
      scheduledDoseKey(event.medicationId, event.regimenId, event.scheduledAt) === key,
  );
}

/** Build the medications Today view for one calendar day. */
export function buildTodayQueue(deps: {
  medications: readonly MedicationProfile[];
  medEvents: readonly MedEvent[];
  day?: string;
  now?: Date;
}): TodayQueue {
  const now = deps.now ?? new Date();
  const day = deps.day ?? now.toISOString().slice(0, 10);
  const nowMs = now.getTime();

  const activeMeds = deps.medications.filter((med) => med.active === true && med.deleted !== true);
  const slots = expandDosesForDay(activeMeds, day);

  const scheduled: TodayScheduledDose[] = slots.map((slot) => {
    const event = findEventForSlot(deps.medEvents, slot);
    return {
      ...slot,
      status: resolveStatus(event, nowMs),
      medEventId: event?.id ?? null,
      skippedReason: event?.skippedReason,
      snoozedUntil: event?.snoozedUntil,
    };
  });

  const prn: TodayPrnRegimen[] = [];
  for (const medication of activeMeds) {
    if (!medicationHasPrn(medication)) continue;
    for (const regimen of medication.regimens) {
      if (regimen.schedule.kind !== 'prn' && regimen.prn === undefined) continue;
      prn.push({
        medication,
        regimenId: regimen.id,
        label: regimen.label,
        dosage: regimen.dosage,
      });
    }
  }

  return { day, scheduled, prn };
}
