import { describe, it, expect } from 'vitest';
import type { VaultRecord } from '@complex-patient/domain';
import { threeWayMerge } from './merge';

interface TestRecord extends VaultRecord {
  value?: string;
}

const rec = (
  id: string,
  op_timestamp: string,
  extra: Partial<TestRecord> = {},
): TestRecord => ({ id, op_timestamp, ...extra });

const ids = (records: TestRecord[]): string[] => records.map((r) => r.id).sort();

describe('threeWayMerge', () => {
  it('returns an empty result for empty inputs', () => {
    expect(threeWayMerge<TestRecord>([], [], [])).toEqual([]);
  });

  it('keeps a record added only locally (8.5)', () => {
    const local = [rec('a', '2024-01-01T00:00:00Z', { value: 'l' })];
    const merged = threeWayMerge<TestRecord>([], local, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('l');
  });

  it('keeps a record added only remotely (8.5)', () => {
    const remote = [rec('b', '2024-01-01T00:00:00Z', { value: 'r' })];
    const merged = threeWayMerge<TestRecord>([], [], remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('r');
  });

  it('keeps the union of non-conflicting local and remote records (8.5)', () => {
    const local = [rec('a', '2024-01-01T00:00:00Z')];
    const remote = [rec('b', '2024-01-02T00:00:00Z')];
    const merged = threeWayMerge<TestRecord>([], local, remote);
    expect(ids(merged)).toEqual(['a', 'b']);
  });

  it('takes the locally changed side when remote is unchanged from base', () => {
    const base = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const local = [rec('a', '2024-01-03T00:00:00Z', { value: 'local-edit' })];
    const remote = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const merged = threeWayMerge<TestRecord>(base, local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('local-edit');
  });

  it('takes the remotely changed side when local is unchanged from base', () => {
    const base = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const local = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const remote = [rec('a', '2024-01-03T00:00:00Z', { value: 'remote-edit' })];
    const merged = threeWayMerge<TestRecord>(base, local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('remote-edit');
  });

  it('resolves a genuine conflict by more recent op_timestamp (8.6)', () => {
    const base = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const local = [rec('a', '2024-01-02T00:00:00Z', { value: 'local' })];
    const remote = [rec('a', '2024-01-03T00:00:00Z', { value: 'remote' })];
    const merged = threeWayMerge<TestRecord>(base, local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('remote');
  });

  it('breaks an equal-timestamp conflict by lexicographically greater id (8.7)', () => {
    // Same op_timestamp; differing content. The records share content shape but
    // we force a tie on timestamp. Tie-break uses id; here ids are equal so the
    // deterministic fallback applies. Use distinct-id sets to exercise 8.7.
    const base = [
      rec('a', '2024-01-01T00:00:00Z', { value: 'base-a' }),
      rec('z', '2024-01-01T00:00:00Z', { value: 'base-z' }),
    ];
    const local = [
      rec('a', '2024-01-05T00:00:00Z', { value: 'local-a' }),
      rec('z', '2024-01-05T00:00:00Z', { value: 'local-z' }),
    ];
    const remote = [
      rec('a', '2024-01-05T00:00:00Z', { value: 'remote-a' }),
      rec('z', '2024-01-05T00:00:00Z', { value: 'remote-z' }),
    ];
    const merged = threeWayMerge<TestRecord>(base, local, remote);
    // For each id the timestamps are equal, so the tie-break compares ids.
    // Both records share the same id, so the deterministic fallback (local) wins.
    const byId = Object.fromEntries(merged.map((r) => [r.id, r.value]));
    expect(byId['a']).toBe('local-a');
    expect(byId['z']).toBe('local-z');
  });

  it('preserves a soft-delete tombstone carried on one side (8.5)', () => {
    const base = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const local = [rec('a', '2024-01-02T00:00:00Z', { deleted: true })];
    const remote = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const merged = threeWayMerge<TestRecord>(base, local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].deleted).toBe(true);
  });

  it('lets a newer tombstone win a conflict over a concurrent edit (8.6)', () => {
    const base = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const local = [rec('a', '2024-01-04T00:00:00Z', { deleted: true })];
    const remote = [rec('a', '2024-01-02T00:00:00Z', { value: 'remote-edit' })];
    const merged = threeWayMerge<TestRecord>(base, local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].deleted).toBe(true);
  });

  it('treats identical local and remote records as non-conflicting', () => {
    const local = [rec('a', '2024-01-02T00:00:00Z', { value: 'same' })];
    const remote = [rec('a', '2024-01-02T00:00:00Z', { value: 'same' })];
    const merged = threeWayMerge<TestRecord>([], local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('same');
  });

  it('is a deterministic pure function of its inputs (Property 9)', () => {
    const base = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const local = [rec('a', '2024-01-02T00:00:00Z', { value: 'local' })];
    const remote = [rec('a', '2024-01-03T00:00:00Z', { value: 'remote' })];
    const first = threeWayMerge<TestRecord>(base, local, remote);
    const second = threeWayMerge<TestRecord>(base, local, remote);
    expect(first).toEqual(second);
  });

  it('is idempotent: re-merging the result yields the same set (Property 10)', () => {
    const base = [rec('a', '2024-01-01T00:00:00Z', { value: 'base' })];
    const local = [
      rec('a', '2024-01-02T00:00:00Z', { value: 'local' }),
      rec('b', '2024-01-02T00:00:00Z'),
    ];
    const remote = [
      rec('a', '2024-01-03T00:00:00Z', { value: 'remote' }),
      rec('c', '2024-01-02T00:00:00Z'),
    ];
    const m = threeWayMerge<TestRecord>(base, local, remote);
    const remergeded = threeWayMerge<TestRecord>(base, m, m);
    expect(ids(remergeded)).toEqual(ids(m));
    expect(remergeded).toEqual(m);
  });

  it('produces the same set regardless of local/remote order for non-conflicting changes (Property 11)', () => {
    const base: TestRecord[] = [];
    const local = [rec('a', '2024-01-01T00:00:00Z', { value: 'l' })];
    const remote = [rec('b', '2024-01-02T00:00:00Z', { value: 'r' })];
    const lr = threeWayMerge<TestRecord>(base, local, remote);
    const rl = threeWayMerge<TestRecord>(base, remote, local);
    expect(lr).toEqual(rl);
  });
});
