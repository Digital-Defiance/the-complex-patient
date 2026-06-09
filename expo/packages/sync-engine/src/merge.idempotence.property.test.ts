/**
 * Property-based test for the three-way merge (Property 10).
 *
 * Property 10: Merge idempotence and convergence.
 * // Feature: complex-patient-platform, Property 10: Merge idempotence and convergence
 *
 * Once a three-way merge has produced a reconciled record set `m`, re-running
 * the merge over that already-merged result is stable: it neither loses nor
 * invents records and it reproduces `m` exactly. This is what guarantees both
 * replicas converge to the same state after exchanging the merged blob — the
 * merge reaches a fixed point.
 *
 * Concrete invariants asserted (derived from the algorithm's semantics: records
 * keyed by `id`, one record per id, output sorted by id):
 *   (a) Idempotence — threeWayMerge(m, m, m) deep-equals m.
 *   (b) Convergence — feeding m back as BOTH local and remote yields m
 *       unchanged for ANY base (threeWayMerge(anyBase, m, m) === m), because the
 *       identical-content fast path resolves every id before base is consulted.
 *
 * Uses @fast-check/vitest with a deliberately small id pool and a small
 * op_timestamp pool so that id overlaps and timestamp collisions (8.6/8.7
 * conflict paths) occur frequently across the generated base/local/remote sets.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type { VaultRecord } from '@complex-patient/domain';
import { threeWayMerge } from './merge';

interface TestRecord extends VaultRecord {
  value?: string;
}

// Small id pool so that ids overlap across base/local/remote and conflicts arise.
const idArb = fc.constantFrom('a', 'b', 'c', 'd');

// Small op_timestamp pool so equal-timestamp tie-breaks (8.7) are exercised.
const timestampArb = fc.constantFrom(
  '2024-01-01T00:00:00Z',
  '2024-01-02T00:00:00Z',
  '2024-01-03T00:00:00Z',
);

// A single record: id + op_timestamp, plus optional content/tombstone so that
// records sharing an id can diverge in content (forcing genuine conflicts).
const recordArb: fc.Arbitrary<TestRecord> = fc.record(
  {
    id: idArb,
    op_timestamp: timestampArb,
    value: fc.option(fc.constantFrom('x', 'y', 'z'), { nil: undefined }),
    deleted: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: ['id', 'op_timestamp'] },
);

// A record set (0–6 records). Duplicate ids within one set collapse via
// last-write-wins in the merge's indexById, mirroring a single side's state.
const recordSetArb: fc.Arbitrary<TestRecord[]> = fc.array(recordArb, {
  minLength: 0,
  maxLength: 6,
});

describe('Property 10: Merge idempotence and convergence', () => {
  /**
   * **Validates: Requirements 8.5, 8.6, 8.7**
   *
   * (a) Idempotence: re-merging the merged result against itself reproduces it
   * exactly — no records lost (8.5), no conflict re-resolved differently
   * (8.6/8.7). The merge has reached a fixed point.
   */
  it.prop([recordSetArb, recordSetArb, recordSetArb], { numRuns: 200 })(
    'threeWayMerge(m, m, m) === m (idempotent fixed point)',
    (base, local, remote) => {
      const m = threeWayMerge<TestRecord>(base, local, remote);
      const remerged = threeWayMerge<TestRecord>(m, m, m);
      expect(remerged).toEqual(m);
    },
  );

  /**
   * **Validates: Requirements 8.5, 8.6, 8.7**
   *
   * (b) Convergence: after a merge, feeding the merged result back as BOTH the
   * local and remote sets yields an unchanged result for ANY base. Both
   * replicas, having exchanged the merged blob, reconcile to the identical
   * state with no further divergence.
   */
  it.prop([recordSetArb, recordSetArb, recordSetArb, recordSetArb], { numRuns: 200 })(
    'threeWayMerge(anyBase, m, m) === m (replicas converge)',
    (base, local, remote, otherBase) => {
      const m = threeWayMerge<TestRecord>(base, local, remote);
      const converged = threeWayMerge<TestRecord>(otherBase, m, m);
      expect(converged).toEqual(m);
    },
  );

  /**
   * **Validates: Requirements 8.5, 8.6, 8.7**
   *
   * Convergence corollary: re-merging against the ORIGINAL base reproduces the
   * merged set as well, so a replay of the conflict cycle with the same base
   * does not perturb an already-reconciled result.
   */
  it.prop([recordSetArb, recordSetArb, recordSetArb], { numRuns: 200 })(
    'threeWayMerge(base, m, m) === m (stable under original base)',
    (base, local, remote) => {
      const m = threeWayMerge<TestRecord>(base, local, remote);
      const stable = threeWayMerge<TestRecord>(base, m, m);
      expect(stable).toEqual(m);
    },
  );
});
