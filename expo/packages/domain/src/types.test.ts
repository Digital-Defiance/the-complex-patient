import { describe, it, expect } from 'vitest';
import type { VaultType, VaultRecord, PartitionPayload } from './types';

describe('Core vault types', () => {
  describe('VaultType', () => {
    it('accepts all valid vault type values', () => {
      const types: VaultType[] = [
        'medications',
        'symptoms',
        'conditions',
        'flares',
        'associations',
      ];
      expect(types).toHaveLength(5);
    });
  });

  describe('VaultRecord', () => {
    it('supports required fields id and op_timestamp', () => {
      const record: VaultRecord = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        op_timestamp: '2024-01-15T10:30:00.000Z',
      };
      expect(record.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(record.op_timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(record.deleted).toBeUndefined();
    });

    it('supports optional deleted field for soft-delete tombstones', () => {
      const record: VaultRecord = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        op_timestamp: '2024-01-15T10:30:00.000Z',
        deleted: true,
      };
      expect(record.deleted).toBe(true);
    });
  });

  describe('PartitionPayload', () => {
    it('wraps an array of VaultRecord instances', () => {
      const payload: PartitionPayload<VaultRecord> = {
        records: [
          { id: 'a', op_timestamp: '2024-01-01T00:00:00Z' },
          { id: 'b', op_timestamp: '2024-01-02T00:00:00Z', deleted: true },
        ],
      };
      expect(payload.records).toHaveLength(2);
      expect(payload.records[0].id).toBe('a');
      expect(payload.records[1].deleted).toBe(true);
    });

    it('works with extended record types', () => {
      interface TestRecord extends VaultRecord {
        name: string;
      }
      const payload: PartitionPayload<TestRecord> = {
        records: [
          { id: '1', op_timestamp: '2024-01-01T00:00:00Z', name: 'test' },
        ],
      };
      expect(payload.records[0].name).toBe('test');
    });

    it('supports empty record arrays', () => {
      const payload: PartitionPayload<VaultRecord> = { records: [] };
      expect(payload.records).toHaveLength(0);
    });
  });
});
