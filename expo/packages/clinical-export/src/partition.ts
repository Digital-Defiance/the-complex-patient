/**
 * Helpers to split decrypted partition records for export and UI.
 */

import type { MedEvent, MedicationProfile, PrnLog, VaultRecord } from '@complex-patient/domain';

export function isDeleted(record: VaultRecord): boolean {
  return record.deleted === true;
}

export function filterActive<T extends VaultRecord>(records: T[]): T[] {
  return records.filter((record) => !isDeleted(record));
}

export function isMedicationProfile(record: VaultRecord): record is MedicationProfile {
  return 'drugName' in record && typeof (record as MedicationProfile).drugName === 'string';
}

export function isMedEvent(record: VaultRecord): record is MedEvent {
  return (
    'scheduledAt' in record &&
    typeof (record as MedEvent).scheduledAt === 'string' &&
    'medicationId' in record
  );
}

export function isPrnLog(record: VaultRecord): record is PrnLog {
  return (
    'medicationId' in record &&
    'takenAt' in record &&
    'amount' in record &&
    typeof (record as PrnLog).amount === 'number' &&
    !isMedEvent(record)
  );
}

export function splitMedicationsPartition(records: VaultRecord[]): {
  medications: MedicationProfile[];
  prnLogs: PrnLog[];
  medEvents: MedEvent[];
} {
  const active = filterActive(records);
  return {
    medications: active.filter(isMedicationProfile),
    prnLogs: active.filter(isPrnLog),
    medEvents: active.filter(isMedEvent),
  };
}
