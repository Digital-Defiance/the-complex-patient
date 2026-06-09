/**
 * Property-based test for the three-way merge (Property 11).
 *
 * Property 11: Commutativity of non-conflicting union
 *   *For any* base and any local/remote sets whose changes do not conflict,
 *   `set(threeWayMerge(base, local, remote)) == set(threeWayMerge(base, remote, local))`.
 *
 * **Validates: Requirements 8.5**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 *
 * ---------------------------------------------------------------------------
 * Constraint applied to the generators (documented):
 *
 * `resolveConflict` is symmetric in `(local, remote)` for every case EXCEPT one
 * degenerate input: two records that share the SAME id, have the SAME
 * `op_timestamp`, but DIFFERENT content, where both have changed relative to
 * base. In that single case the implementation falls back to the `local`
 * argument purely to remain a total, deterministic pure function — an inherent
 * asymmetry that the 8.5 non-conflicting-union guarantee does not cover.
 *
 * To keep the generators inside the space Property 11 actually claims, we
 * guarantee that any id present on BOTH sides receives DISTINCT
 * `op_timestamp`s. With distinct timestamps the conflict tie-break depends only
 * on the records' own fields (timestamp, then id) and not on which argument
 * position they occupy, so the merge is genuinely commutative across the whole
 * generated space (one-sided changes, identical content, and timestamp-decided
 * conflicts alike).
 * ---------------------------------------------------------------------------
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type { VaultRecord } from '@complex-patient/domain';
import { threeWayMerge } from './merge';

interface TestRecord extends VaultRecord {
  value?: string;
}

/** Map a small integer into a fixed-width ISO 8601 timestamp.
 *  Distinct integers map to distinct strings whose lexical order matches the
 *  numeric order (fixed-width ISO format), so timestamp comparisons in the
 *  merge behave as expected. */
const isoFromInt = (n: number): string => new Date(n * 1000).toISOString();

const idArb = fc.string({ minLength: 1, maxLength: 4 });
const valueArb = fc.string({ maxLength: 6 });
const tsIntArb = fc.integer({ min: 0, max: 1_000_000 });

/**
 * A per-id specification describing whether the id appears in base/local/remote
 * and with what content. One spec produces at most one record per side.
 */
const recordSpecArb = fc.record({
  id: idArb,
  inBase: fc.boolean(),
  inLocal: fc.boolean(),
  inRemote: fc.boolean(),
  baseValue: valueArb,
  localValue: valueArb,
  remoteValue: valueArb,
  baseTs: tsIntArb,
  localTs: tsIntArb,
  remoteTs: tsIntArb,
  localDeleted: fc.boolean(),
  remoteDeleted: fc.boolean(),
});

type RecordSpec = {
  id: string;
  inBase: boolean;
  inLocal: boolean;
  inRemote: boolean;
  baseValue: string;
  localValue: string;
  remoteValue: string;
  baseTs: number;
  localTs: number;
  remoteTs: number;
  localDeleted: boolean;
  remoteDeleted: boolean;
};

interface Scenario {
  base: TestRecord[];
  local: TestRecord[];
  remote: TestRecord[];
}

const makeRecord = (
  id: string,
  ts: number,
  value: string,
  deleted: boolean,
): TestRecord => (deleted
  ? { id, op_timestamp: isoFromInt(ts), value, deleted: true }
  : { id, op_timestamp: isoFromInt(ts), value });

/**
 * Build base/local/remote arrays from a list of unique-id specs, enforcing the
 * documented constraint: any id present on both sides gets distinct timestamps.
 */
function buildScenario(specs: readonly RecordSpec[]): Scenario {
  const base: TestRecord[] = [];
  const local: TestRecord[] = [];
  const remote: TestRecord[] = [];

  for (const s of specs) {
    if (s.inBase) {
      base.push(makeRecord(s.id, s.baseTs, s.baseValue, false));
    }

    let localTs = s.localTs;
    let remoteTs = s.remoteTs;
    // Constraint: shared ids must not collide on op_timestamp (see file header).
    if (s.inLocal && s.inRemote && localTs === remoteTs) {
      remoteTs = localTs + 1;
    }

    if (s.inLocal) {
      local.push(makeRecord(s.id, localTs, s.localValue, s.localDeleted));
    }
    if (s.inRemote) {
      remote.push(makeRecord(s.id, remoteTs, s.remoteValue, s.remoteDeleted));
    }
  }

  return { base, local, remote };
}

// Scenarios with unique ids across all specs (ids are deduplicated by `selector`).
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .uniqueArray(recordSpecArb, {
    selector: (s) => s.id,
    maxLength: 8,
  })
  .map(buildScenario);

// A strictly non-conflicting scenario: local and remote operate on DISJOINT id
// sets, so no id is ever present on both sides — the purest expression of the
// 8.5 union. base is arbitrary and never affects which records survive here.
const disjointScenarioArb: fc.Arbitrary<Scenario> = fc
  .uniqueArray(
    fc.record({
      id: idArb,
      side: fc.constantFrom<'local' | 'remote'>('local', 'remote'),
      inBase: fc.boolean(),
      value: valueArb,
      ts: tsIntArb,
      deleted: fc.boolean(),
    }),
    { selector: (s) => s.id, maxLength: 10 },
  )
  .map((specs) => {
    const base: TestRecord[] = [];
    const local: TestRecord[] = [];
    const remote: TestRecord[] = [];
    for (const s of specs) {
      if (s.inBase) base.push(makeRecord(s.id, s.ts, s.value, false));
      const target = s.side === 'local' ? local : remote;
      target.push(makeRecord(s.id, s.ts, s.value, s.deleted));
    }
    return { base, local, remote };
  });

describe('Property 11: Commutativity of non-conflicting union', () => {
  /**
   * **Validates: Requirements 8.5**
   *
   * Disjoint local/remote id sets: swapping the arguments yields an identical
   * merged result. Output is sorted by id, so identical sets imply deep array
   * equality.
   */
  it.prop([disjointScenarioArb])(
    'disjoint local/remote sets merge identically regardless of argument order',
    ({ base, local, remote }) => {
      const lr = threeWayMerge<TestRecord>(base, local, remote);
      const rl = threeWayMerge<TestRecord>(base, remote, local);
      expect(lr).toEqual(rl);
    },
  );

  /**
   * **Validates: Requirements 8.5**
   *
   * General scenarios (one-sided changes, identical content, and
   * timestamp-decided conflicts) with the documented distinct-timestamp
   * constraint on shared ids. Commutativity must hold across the whole space.
   */
  it.prop([scenarioArb])(
    'swapping local and remote yields the same merged set',
    ({ base, local, remote }) => {
      const lr = threeWayMerge<TestRecord>(base, local, remote);
      const rl = threeWayMerge<TestRecord>(base, remote, local);

      // Output is one record per id, sorted by id, so set equality is exactly
      // deep array equality.
      expect(lr).toEqual(rl);

      // Cross-check the set-of-ids equality explicitly to mirror the design's
      // set-based statement.
      expect(lr.map((r) => r.id)).toEqual(rl.map((r) => r.id));
    },
  );
});
