/**
 * Compute upcoming local notification triggers from medication schedules.
 */

import type { MedicationProfile } from '@complex-patient/domain';
import { expandDosesForDay } from './schedule';

export interface MedicationNotificationTrigger {
  medicationId: string;
  regimenId: string;
  drugName: string;
  scheduledAt: string;
  title: string;
  body: string;
}

const HORIZON_DAYS = 7;

/** Collect dose reminders for the next week (native local notifications). */
export function buildMedicationNotificationTriggers(
  medications: readonly MedicationProfile[],
  startDay?: string,
): MedicationNotificationTrigger[] {
  const start = startDay ?? new Date().toISOString().slice(0, 10);
  const triggers: MedicationNotificationTrigger[] = [];

  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const date = new Date(`${start}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const day = date.toISOString().slice(0, 10);
    for (const slot of expandDosesForDay(medications, day)) {
      triggers.push({
        medicationId: slot.medicationId,
        regimenId: slot.regimenId,
        drugName: slot.drugName,
        scheduledAt: slot.scheduledAt,
        title: 'Medication reminder',
        body: slot.regimenLabel
          ? `Time to take ${slot.drugName} (${slot.regimenLabel}) — ${slot.dosageLabel}`
          : `Time to take ${slot.drugName} — ${slot.dosageLabel}`,
      });
    }
  }

  return triggers;
}

export function notificationTriggerId(
  medicationId: string,
  regimenId: string,
  scheduledAt: string,
): string {
  return `med:${medicationId}:${regimenId}:${scheduledAt}`;
}
