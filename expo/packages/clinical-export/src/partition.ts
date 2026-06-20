/**
 * Helpers to split decrypted partition records for export.
 */

import type { MedicationProfile, PrnLog, VaultRecord } from '@complex-patient/domain';

export function isDeleted(record: VaultRecord): boolean {
  return record.deleted === true;
}

export function filterActive<T extends VaultRecord>(records: T[]): T[] {
  return records.filter((record) => !isDeleted(record));
}

export function isMedicationProfile(record: VaultRecord): record is MedicationProfile {
  return 'drugName' in record && typeof (record as MedicationProfile).drugName === 'string';
}

export function isPrnLog(record: VaultRecord): record is PrnLog {
  return (
    'medicationId' in record &&
    'takenAt' in record &&
    typeof (record as PrnLog).medicationId === 'string'
  );
}

export function splitMedicationsPartition(records: VaultRecord[]): {
  medications: MedicationProfile[];
  prnLogs: PrnLog[];
} {
  const active = filterActive(records);
  return {
    medications: active.filter(isMedicationProfile),
    prnLogs: active.filter(isPrnLog),
  };
}
