/**
 * Adherence mutations — take, skip, snooze scheduled doses via MedEvent records.
 */

import type { MedEvent, VaultRecord } from '@complex-patient/domain';
import { scheduledDoseKey } from './schedule';

export interface MedEventMutationResult {
  records: VaultRecord[];
  event: MedEvent;
}

function generateId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return `med-event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function upsertMedEvent(
  current: readonly VaultRecord[],
  next: MedEvent,
): VaultRecord[] {
  const without = current.filter((record) => record.id !== next.id);
  return [...without, next];
}

function findExistingEvent(
  current: readonly VaultRecord[],
  medicationId: string,
  regimenId: string,
  scheduledAt: string,
): MedEvent | undefined {
  const key = scheduledDoseKey(medicationId, regimenId, scheduledAt);
  return current.find(
    (record): record is MedEvent =>
      'scheduledAt' in record &&
      scheduledDoseKey(
        (record as MedEvent).medicationId,
        (record as MedEvent).regimenId,
        (record as MedEvent).scheduledAt,
      ) === key,
  );
}

export function recordDoseTaken(deps: {
  current: readonly VaultRecord[];
  medicationId: string;
  regimenId: string;
  scheduledAt: string;
  takenAt?: string;
}): MedEventMutationResult {
  const takenAt = deps.takenAt ?? new Date().toISOString();
  const existing = findExistingEvent(
    deps.current,
    deps.medicationId,
    deps.regimenId,
    deps.scheduledAt,
  );
  const event: MedEvent = {
    id: existing?.id ?? generateId(),
    op_timestamp: takenAt,
    medicationId: deps.medicationId,
    regimenId: deps.regimenId,
    scheduledAt: deps.scheduledAt,
    takenAt,
    status: 'taken',
  };
  return { records: upsertMedEvent(deps.current, event), event };
}

export function recordDoseSkipped(deps: {
  current: readonly VaultRecord[];
  medicationId: string;
  regimenId: string;
  scheduledAt: string;
  reason?: string;
  skippedAt?: string;
}): MedEventMutationResult {
  const skippedAt = deps.skippedAt ?? new Date().toISOString();
  const existing = findExistingEvent(
    deps.current,
    deps.medicationId,
    deps.regimenId,
    deps.scheduledAt,
  );
  const event: MedEvent = {
    id: existing?.id ?? generateId(),
    op_timestamp: skippedAt,
    medicationId: deps.medicationId,
    regimenId: deps.regimenId,
    scheduledAt: deps.scheduledAt,
    takenAt: null,
    status: 'skipped',
    skippedReason: deps.reason ?? 'skipped',
  };
  return { records: upsertMedEvent(deps.current, event), event };
}

export function recordDoseSnoozed(deps: {
  current: readonly VaultRecord[];
  medicationId: string;
  regimenId: string;
  scheduledAt: string;
  snoozedUntil: string;
}): MedEventMutationResult {
  const existing = findExistingEvent(
    deps.current,
    deps.medicationId,
    deps.regimenId,
    deps.scheduledAt,
  );
  const event: MedEvent = {
    id: existing?.id ?? generateId(),
    op_timestamp: new Date().toISOString(),
    medicationId: deps.medicationId,
    regimenId: deps.regimenId,
    scheduledAt: deps.scheduledAt,
    takenAt: null,
    status: 'snoozed',
    snoozedUntil: deps.snoozedUntil,
  };
  return { records: upsertMedEvent(deps.current, event), event };
}

export interface AdherenceDaySummary {
  day: string;
  scheduledCount: number;
  takenCount: number;
  skippedCount: number;
  missedCount: number;
}

/** Summarize adherence for a trailing day window. */
export function summarizeAdherenceHistory(deps: {
  medEvents: readonly MedEvent[];
  dayCount?: number;
  referenceDate?: Date;
}): AdherenceDaySummary[] {
  const reference = deps.referenceDate ?? new Date();
  const dayCount = deps.dayCount ?? 14;
  const days: string[] = [];

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(reference);
    date.setUTCDate(date.getUTCDate() - offset);
    days.push(date.toISOString().slice(0, 10));
  }

  return days.map((day) => {
    const dayEvents = deps.medEvents.filter((event) => event.scheduledAt.slice(0, 10) === day);
    const takenCount = dayEvents.filter((event) => event.takenAt !== null).length;
    const skippedCount = dayEvents.filter(
      (event) => event.takenAt === null && (event.status === 'skipped' || event.skippedReason),
    ).length;
    return {
      day,
      scheduledCount: dayEvents.length,
      takenCount,
      skippedCount,
      missedCount: dayEvents.filter(
        (event) =>
          event.takenAt === null &&
          event.status !== 'skipped' &&
          !event.skippedReason &&
          event.status !== 'snoozed',
      ).length,
    };
  });
}
