/**
 * Partition helper unit tests.
 */

import { describe, expect, it } from 'vitest';
import type { VaultRecord } from '@complex-patient/domain';
import { makeTestMedicationProfile } from '@complex-patient/domain';
import {
  filterActive,
  isMedicationProfile,
  isPrnLog,
  splitMedicationsPartition,
} from './partition';

describe('splitMedicationsPartition', () => {
  it('splits medication profiles and PRN logs from a mixed partition', () => {
    const records: VaultRecord[] = [
      makeTestMedicationProfile({
        id: 'med-1',
        drugName: 'Aspirin',
        dosage: '81mg',
        prescribingPhysician: 'Dr. A',
        conditionTreated: 'Pain',
        schedule: { kind: 'prn' },
      }),
      {
        id: 'prn-1',
        op_timestamp: '2026-01-02T00:00:00.000Z',
        medicationId: 'med-1',
        amount: 1,
        takenAt: '2026-01-02T08:00:00.000Z',
      },
    ];

    const split = splitMedicationsPartition(records);
    expect(split.medications).toHaveLength(1);
    expect(split.prnLogs).toHaveLength(1);
    expect(split.medications[0]?.id).toBe('med-1');
    expect(split.prnLogs[0]?.medicationId).toBe('med-1');
    expect(split.medEvents).toHaveLength(0);
  });

  it('splits med events from mixed partition', () => {
    const records: VaultRecord[] = [
      {
        id: 'event-1',
        op_timestamp: '2026-01-02T08:00:00.000Z',
        medicationId: 'med-1',
        regimenId: 'reg-1',
        scheduledAt: '2026-01-02T08:00:00.000Z',
        takenAt: '2026-01-02T08:05:00.000Z',
      },
    ];
    const split = splitMedicationsPartition(records);
    expect(split.medEvents).toHaveLength(1);
    expect(split.medications).toHaveLength(0);
  });

  it('excludes soft-deleted records', () => {
    const records: VaultRecord[] = [
      makeTestMedicationProfile({
        id: 'med-deleted',
        drugName: 'Removed',
        dosage: '1mg',
        active: false,
        schedule: { kind: 'prn' },
        deleted: true,
      }),
    ];

    expect(splitMedicationsPartition(records).medications).toHaveLength(0);
    expect(filterActive(records)).toHaveLength(0);
  });
});

describe('record type guards', () => {
  it('detects medication profiles and PRN logs', () => {
    const med: VaultRecord = makeTestMedicationProfile({
      id: 'med-1',
      drugName: 'Drug',
      dosage: '1mg',
      prescribingPhysician: 'Dr.',
      conditionTreated: 'X',
      schedule: { kind: 'prn' },
    });
    const prn: VaultRecord = {
      id: 'prn-1',
      op_timestamp: '2026-01-02T00:00:00.000Z',
      medicationId: 'med-1',
      amount: 1,
      takenAt: '2026-01-02T08:00:00.000Z',
    };

    expect(isMedicationProfile(med)).toBe(true);
    expect(isPrnLog(prn)).toBe(true);
    expect(isPrnLog(med)).toBe(false);
  });
});
