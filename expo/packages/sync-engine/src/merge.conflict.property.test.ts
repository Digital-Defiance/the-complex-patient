/**
 * Property-based tests for the three-way merge conflict resolution.
 *
 * Property 9: Deterministic conflict resolution
 *
 * For any pair of conflicting records sharing an id, the merge selects the
 * record with the more recent `op_timestamp` (8.6), and on equal timestamps
 * selects the record with the lexicographically greater id (8.7); consequently
 * the merge is a deterministic pure function of `(base, local, remote)` —
 * identical inputs always produce identical output.
 *
 * Because a genuine conflict is, by definition, a pair of records sharing the
 * same id, the 8.7 id tie-break is degenerate within a single conflict (the
 * two ids are equal). In that case the merge must still make a deterministic,
 * stable choice. These tests assert exactly that.
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type { VaultRecord } from '@complex-patient/domain';
import { threeWayMerge } from './merge';

interface TestRecord extends VaultRecord {
  value?: string;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A canonical fixed-width ISO-8601 UTC timestamp ("YYYY-MM-DDTHH:mm:ss.sssZ").
 * For this format, lexicographic string ordering equals chronological ordering,
 * which mirrors how `merge.ts` compares `op_timestamp` values with `>`.
 */
const isoTimestamp: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970-01-01 .. ~2100-01-01
  .map((ms) => new Date(ms).toISOString());

/** Small id pool so that local/remote sets frequently collide into conflicts. */
const idArb: fc.Arbitrary<string> = fc.constantFrom('a', 'b', 'c', 'd', 'e');

const valueArb: fc.Arbitrary<string> = fc.string({ maxLength: 8 });

/** An arbitrary vault record drawn from the small id pool. */
const recordArb: fc.Arbitrary<TestRecord> = fc.record({
  id: idArb,
  op_timestamp: isoTimestamp,
  value: valueArb,
  deleted: fc.boolean(),
});

/** A set of records (duplicate ids allowed — last-write-wins within a side). */
const recordSetArb: fc.Arbitrary<TestRecord[]> = fc.array(recordArb, {
  maxLength: 8,
});

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe('Property 9: Deterministic conflict resolution', () => {
  /**
   * **Validates: Requirements 8.6, 8.7**
   *
   * Determinism / purity: calling threeWayMerge twice with identical inputs
   * yields deeply equal output, and it does not mutate its inputs.
   */
  it.prop([recordSetArb, recordSetArb, recordSetArb])(
    'is a deterministic pure function of (base, local, remote)',
    (base, local, remote) => {
      const baseSnapshot = JSON.stringify(base);
      const localSnapshot = JSON.stringify(local);
      const remoteSnapshot = JSON.stringify(remote);

      const first = threeWayMerge<TestRecord>(base, local, remote);
      const second = threeWayMerge<TestRecord>(base, local, remote);

      // Identical inputs -> identical output.
      expect(second).toEqual(first);

      // Pure: inputs are not mutated.
      expect(JSON.stringify(base)).toBe(baseSnapshot);
      expect(JSON.stringify(local)).toBe(localSnapshot);
      expect(JSON.stringify(remote)).toBe(remoteSnapshot);
    },
  );

  /**
   * **Validates: Requirements 8.6**
   *
   * Genuine conflict (same id changed differently on both sides relative to
   * base) with distinct op_timestamps: the record with the more recent
   * op_timestamp wins.
   */
  it.prop([idArb, isoTimestamp, isoTimestamp, isoTimestamp])(
    'resolves a genuine conflict to the record with the more recent op_timestamp',
    (id, baseTs, localTs, remoteTs) => {
      // Distinct timestamps so there is a strict winner by recency.
      fc.pre(localTs !== remoteTs);

      // Distinct content on all three sides guarantees both sides changed from
      // base and that local and remote genuinely differ -> a real conflict.
      const base: TestRecord[] = [{ id, op_timestamp: baseTs, value: 'base' }];
      const local: TestRecord[] = [{ id, op_timestamp: localTs, value: 'local' }];
      const remote: TestRecord[] = [{ id, op_timestamp: remoteTs, value: 'remote' }];

      const merged = threeWayMerge<TestRecord>(base, local, remote);

      // Winner by more recent op_timestamp (string compare == chronological).
      const expected = localTs > remoteTs ? local[0] : remote[0];

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual(expected);
    },
  );

  /**
   * **Validates: Requirements 8.7**
   *
   * Genuine conflict with equal op_timestamps. A conflict pair always shares
   * the same id, so the lexicographic id tie-break is degenerate; the merge
   * must therefore make a deterministic, stable choice that is one of the two
   * conflicting records.
   */
  it.prop([idArb, isoTimestamp, isoTimestamp, valueArb, valueArb])(
    'breaks an equal-timestamp conflict with a deterministic stable choice',
    (id, baseTs, conflictTs, localValue, remoteValue) => {
      // Force genuinely different content on each side so a real conflict
      // exists, while pinning local and remote to the SAME op_timestamp.
      const base: TestRecord[] = [{ id, op_timestamp: baseTs, value: 'base' }];
      const local: TestRecord[] = [
        { id, op_timestamp: conflictTs, value: `L:${localValue}` },
      ];
      const remote: TestRecord[] = [
        { id, op_timestamp: conflictTs, value: `R:${remoteValue}` },
      ];

      const first = threeWayMerge<TestRecord>(base, local, remote);
      const second = threeWayMerge<TestRecord>(base, local, remote);

      // Deterministic: repeated calls agree.
      expect(second).toEqual(first);

      // The winner is exactly one of the two conflicting records.
      expect(first).toHaveLength(1);
      const winnerIsLocal = JSON.stringify(first[0]) === JSON.stringify(local[0]);
      const winnerIsRemote = JSON.stringify(first[0]) === JSON.stringify(remote[0]);
      expect(winnerIsLocal || winnerIsRemote).toBe(true);
    },
  );
});
