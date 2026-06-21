import { describe, expect, it, vi } from 'vitest';
import type { VaultRecord } from '@complex-patient/domain';
import { countExportRecords, readClinicalExportSource } from './export-source';
import type { HomeEntryController } from './home-entry';

function makeHome(reads: Record<string, VaultRecord[]>): HomeEntryController {
  return {
    getStatus: () => 'ready',
    read: vi.fn((vaultType: string) => ({ records: reads[vaultType] ?? [], syncVersion: 1 })),
  } as unknown as HomeEntryController;
}

describe('readClinicalExportSource', () => {
  it('maps vault partitions into export source records', () => {
    const home = makeHome({
      medications: [
        {
          id: 'med-1',
          op_timestamp: 't',
          drugName: 'Ibuprofen',
          dosage: '200mg',
          form: 'tablet',
          prescribingPhysician: '',
          conditionTreated: '',
          active: true,
          schedule: { kind: 'prn' },
        },
      ],
      symptoms: [{ id: 'sym-1', op_timestamp: 't', severity: 3, note: 'headache' }],
      conditions: [],
      flares: [],
      associations: [],
      locationTrail: [],
    });

    const source = readClinicalExportSource(home);
    expect(source.medications).toHaveLength(1);
    expect(source.symptoms).toHaveLength(1);
    expect(countExportRecords(source)).toBe(2);
  });

  it('excludes tombstoned records', () => {
    const home = makeHome({
      medications: [],
      symptoms: [{ id: 'sym-deleted', op_timestamp: 't', severity: 1, deleted: true }],
      conditions: [],
      flares: [],
      associations: [],
      locationTrail: [],
    });

    const source = readClinicalExportSource(home);
    expect(source.symptoms).toHaveLength(0);
    expect(countExportRecords(source)).toBe(0);
  });
});
