/**
 * Property-based tests for the three-way merge (sync-engine).
 *
 * Property 8: Three-way merge loses no non-conflicting data (Req 8.5)
 *
 * For any base/local/remote record sets, the merge must not drop any record
 * that is present in either local or remote. Concretely:
 *   - every id appearing in local or remote appears exactly once in the output;
 *   - a record present on only one side is preserved verbatim;
 *   - a record changed on only one side relative to base is preserved verbatim
 *     with its changed content;
 *   - for genuine conflicts the merged record is one of the two real inputs
 *     (the merge never fabricates data).
 *
 * Uses @fast-check/vitest for property-based testing integration.
 *
 * NOTE: Properties 9, 10, 11 (determinism, idempotence, commutativity) are
 * separate tasks; this file implements Property 8 only. The record/side
 * generators below are shared helpers those tasks may reuse.
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

// A deliberately small id pool so that overlaps and conflicts between sides
// actually occur with high probability.
const ID_POOL = ['r1', 'r2', 'r3', 'r4'] as const;

// A small timestamp space so equal-timestamp ties (8.7) are exercised too.
const opTimestampArb = fc
  .integer({ min: 1, max: 6 })
  .map((d) => `2024-01-0${d}T00:00:00Z`);

const contentArb = fc.constantFrom('alpha', 'beta', 'gamma', 'delta');

/**
 * Generate a record for a fixed id: either a live record carrying a `value`,
 * or a soft-delete tombstone (`deleted: true`).
 */
function recordArb(id: string): fc.Arbitrary<TestRecord> {
  return fc
    .record({
      op_timestamp: opTimestampArb,
      content: contentArb,
      deleted: fc.boolean(),
    })
    .map(({ op_timestamp, content, deleted }): TestRecord =>
      deleted ? { id, op_timestamp, deleted: true } : { id, op_timestamp, value: content },
    );
}

/**
 * Generate one side (base/local/remote) as a set of records with unique ids
 * drawn from the shared pool. Each id is independently present or absent, so a
 * side has between 0 and ID_POOL.length records and never duplicate ids.
 */
const sideArb: fc.Arbitrary<TestRecord[]> = fc
  .tuple(...ID_POOL.map((id) => fc.option(recordArb(id), { nil: undefined })))
  .map((entries) => entries.filter((r): r is TestRecord => r !== undefined));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Key-order-independent canonical form for structural equality checks. */
function canonical(record: TestRecord): string {
  const obj = record as unknown as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return JSON.stringify(keys.map((k) => [k, obj[k]]));
}

function recordsEqual(a: TestRecord, b: TestRecord): boolean {
  return canonical(a) === canonical(b);
}

function indexById(records: readonly TestRecord[]): Map<string, TestRecord> {
  const map = new Map<string, TestRecord>();
  for (const r of records) map.set(r.id, r);
  return map;
}

// ---------------------------------------------------------------------------
// Property 8: Three-way merge loses no non-conflicting data
// **Validates: Requirements 8.5**
// ---------------------------------------------------------------------------

describe('Property 8: Three-way merge loses no non-conflicting data', () => {
  it.prop([sideArb, sideArb, sideArb], { numRuns: 500 })(
    'every non-conflicting record present in local or remote survives the merge',
    (base, local, remote) => {
      const merged = threeWayMerge<TestRecord>(base, local, remote);

      const baseMap = indexById(base);
      const localMap = indexById(local);
      const remoteMap = indexById(remote);
      const mergedMap = indexById(merged);

      // The set of ids that must be retained: the union of ids in local or
      // remote (8.5).
      const expectedIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);

      // 1. Exactly the union of ids appears in the output — nothing dropped and
      //    nothing fabricated. One record per id (no duplicates).
      expect(new Set(mergedMap.keys())).toEqual(expectedIds);
      expect(merged.length).toBe(expectedIds.size);

      for (const id of expectedIds) {
        const localRec = localMap.get(id);
        const remoteRec = remoteMap.get(id);
        const baseRec = baseMap.get(id);
        const mergedRec = mergedMap.get(id)!;

        if (localRec !== undefined && remoteRec === undefined) {
          // Present only locally: preserved verbatim.
          expect(mergedRec).toEqual(localRec);
        } else if (remoteRec !== undefined && localRec === undefined) {
          // Present only remotely: preserved verbatim.
          expect(mergedRec).toEqual(remoteRec);
        } else {
          // Present on both sides.
          const local2 = localRec!;
          const remote2 = remoteRec!;

          if (recordsEqual(local2, remote2)) {
            // Identical content: not a conflict, the shared value is preserved.
            expect(recordsEqual(mergedRec, local2)).toBe(true);
            continue;
          }

          const localChanged = baseRec === undefined || !recordsEqual(local2, baseRec);
          const remoteChanged = baseRec === undefined || !recordsEqual(remote2, baseRec);

          if (localChanged && !remoteChanged) {
            // One-sided change: the locally changed record is preserved (8.5).
            expect(mergedRec).toEqual(local2);
          } else if (remoteChanged && !localChanged) {
            // One-sided change: the remotely changed record is preserved (8.5).
            expect(mergedRec).toEqual(remote2);
          } else {
            // Genuine conflict: the merge must pick one of the two real inputs;
            // it never invents or drops data.
            const matchesOne =
              recordsEqual(mergedRec, local2) || recordsEqual(mergedRec, remote2);
            expect(matchesOne).toBe(true);
          }
        }
      }
    },
  );
});
