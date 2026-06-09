/**
 * Property-based test for the adaptive polypharmacy view (Property 15).
 *
 * Property 15: Adaptive polypharmacy view boundary
 *
 * *For any* set of active daily medications: when the active count is greater
 * than 10, the view is grouped into the fixed block order
 * [Morning, Midday, Evening, Night/Bedtime] with members alphabetical within
 * each block, multi-time medications appearing in each matching block, no-time
 * / PRN medications in a trailing "As Needed" section, and empty blocks
 * omitted; when the active count is 10 or fewer, the view is a single
 * alphabetical flat list of exactly the active medications.
 *
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type { MedicationProfile, MedicationSchedule, TimeBlock } from '@complex-patient/domain';
import { buildPolypharmacyView } from './view';

// ---------------------------------------------------------------------------
// Reference constants mirroring the specification (NOT importing the SUT's
// private helpers, so the test is an independent oracle).
// ---------------------------------------------------------------------------

/** Fixed presentation order of the time-of-day blocks (14.1). */
const BLOCK_ORDER: readonly TimeBlock[] = ['Morning', 'Midday', 'Evening', 'Night/Bedtime'];

/** The >10 boundary: strictly greater switches from flat to grouped. */
const FLAT_LIST_MAX = 10;

// ---------------------------------------------------------------------------
// Reference oracle helpers (independent reimplementation of the windows 14.3)
// ---------------------------------------------------------------------------

/** Parse an "HH:mm" 24-hour time into minutes-since-midnight, or null. */
function parseMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

/** Reference block-window assignment (14.3). */
function blockForTime(time: string): TimeBlock | null {
  const minutes = parseMinutes(time);
  if (minutes === null) return null;
  if (minutes >= 300 && minutes <= 659) return 'Morning'; // 05:00–10:59
  if (minutes >= 660 && minutes <= 1019) return 'Midday'; // 11:00–16:59
  if (minutes >= 1020 && minutes <= 1319) return 'Evening'; // 17:00–21:59
  return 'Night/Bedtime'; // 22:00–23:59 or 00:00–04:59 (wraps midnight)
}

/** Scheduled "HH:mm" times for a schedule; PRN/taper carry none (14.4). */
function scheduledTimes(schedule: MedicationSchedule): readonly string[] {
  switch (schedule.kind) {
    case 'weekly':
    case 'alternating':
    case 'rotating-interval':
      return schedule.times;
    default:
      return [];
  }
}

/** The set of blocks a medication occupies by its scheduled times (14.3). */
function expectedBlocks(med: MedicationProfile): Set<TimeBlock> {
  const blocks = new Set<TimeBlock>();
  for (const time of scheduledTimes(med.schedule)) {
    const block = blockForTime(time);
    if (block !== null) blocks.add(block);
  }
  return blocks;
}

/** The comparator the view uses: drugName, then id as tiebreak (14.1, 14.2). */
function compareMeds(a: MedicationProfile, b: MedicationProfile): number {
  const byName = a.drugName.localeCompare(b.drugName);
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/** Assert a list of meds is ordered by {@link compareMeds}. */
function isSorted(meds: readonly MedicationProfile[]): boolean {
  for (let i = 1; i < meds.length; i++) {
    if (compareMeds(meds[i - 1], meds[i]) > 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Generators (smart, constrained to the input space). Avoids fc.stringOf.
// ---------------------------------------------------------------------------

/** "HH:mm" time arbitrary covering all four block windows + midnight wrap. */
const timeArb: fc.Arbitrary<string> = fc
  .record({ h: fc.integer({ min: 0, max: 23 }), m: fc.integer({ min: 0, max: 59 }) })
  .map(({ h, m }) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** 0–4 scheduled times (allows no-time and multi-time meds). */
const timesArb: fc.Arbitrary<string[]> = fc.array(timeArb, { minLength: 0, maxLength: 4 });

/** Drug names from a small alphabet to force both collisions and ordering. */
const drugNameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'), { minLength: 1, maxLength: 4 })
  .map((chars) => chars.join(''));

/** Schedule arbitrary mixing timed kinds with PRN/taper (no-time → As Needed). */
const scheduleArb: fc.Arbitrary<MedicationSchedule> = fc.oneof(
  timesArb.map((times) => ({ kind: 'weekly', daysOfWeek: ['MON'], times }) as MedicationSchedule),
  timesArb.map(
    (times) =>
      ({ kind: 'alternating', startDate: '2026-01-01', times }) as MedicationSchedule,
  ),
  timesArb.map(
    (times) =>
      ({ kind: 'rotating-interval', everyNDays: 2, times }) as MedicationSchedule,
  ),
  fc.constant({ kind: 'prn' } as MedicationSchedule),
  fc.constant({
    kind: 'taper',
    phases: [{ weekIndex: 0, dosage: '5mg' }],
  } as MedicationSchedule),
);

/**
 * A medication "spec" without an id; the id is assigned deterministically by
 * array index in the test body to guarantee uniqueness (needed for the sort
 * tiebreak to be well-defined).
 */
interface MedSpec {
  drugName: string;
  active: boolean;
  deleted: boolean;
  schedule: MedicationSchedule;
}

const medSpecArb: fc.Arbitrary<MedSpec> = fc.record({
  drugName: drugNameArb,
  active: fc.boolean(),
  deleted: fc.boolean(),
  schedule: scheduleArb,
});

/** 0–24 medication specs — spans both sides of the >10/≤10 boundary. */
const medSpecsArb: fc.Arbitrary<MedSpec[]> = fc.array(medSpecArb, { minLength: 0, maxLength: 24 });

/** Materialise specs into full MedicationProfile records with unique ids. */
function buildMeds(specs: readonly MedSpec[]): MedicationProfile[] {
  return specs.map((spec, index) => ({
    id: `m-${index}`,
    op_timestamp: '2026-01-01T00:00:00.000Z',
    drugName: spec.drugName,
    dosage: '5mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'Condition',
    active: spec.active,
    deleted: spec.deleted,
    schedule: spec.schedule,
  }));
}

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

describe('Property 15: Adaptive polypharmacy view boundary', () => {
  /**
   * **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**
   */
  it.prop([medSpecsArb], { numRuns: 500 })(
    'grouped above the boundary, flat at or below it, with all invariants',
    (specs) => {
      const meds = buildMeds(specs);
      const active = meds.filter((m) => m.active === true && m.deleted !== true);
      const activeIds = new Set(active.map((m) => m.id));

      const view = buildPolypharmacyView(meds);

      if (active.length <= FLAT_LIST_MAX) {
        // 14.2 — single flat alphabetical list of exactly the active meds.
        expect(view.layout).toBe('flat');
        if (view.layout !== 'flat') return;

        expect(view.medications).toHaveLength(active.length);
        expect(new Set(view.medications.map((m) => m.id))).toEqual(activeIds);
        expect(isSorted(view.medications)).toBe(true);
        return;
      }

      // 14.1 — >10 active → grouped layout.
      expect(view.layout).toBe('grouped');
      if (view.layout !== 'grouped') return;

      const presentBlocks = view.blocks.map((b) => b.block);

      // 14.1 — blocks appear as a subsequence of the fixed order (relative
      // ordering preserved; subsequence also implies no duplicate blocks).
      const orderIndex = (b: TimeBlock) => BLOCK_ORDER.indexOf(b);
      for (let i = 1; i < presentBlocks.length; i++) {
        expect(orderIndex(presentBlocks[i - 1])).toBeLessThan(orderIndex(presentBlocks[i]));
      }

      // 14.5 — no empty block is present, and each block is alphabetical (14.1).
      for (const block of view.blocks) {
        expect(block.medications.length).toBeGreaterThan(0);
        expect(isSorted(block.medications)).toBe(true);
      }

      // 14.4 — As Needed section is alphabetical and disjoint from the blocks.
      expect(isSorted(view.asNeeded)).toBe(true);
      const blockIds = view.blocks.flatMap((b) => b.medications.map((m) => m.id));
      const asNeededIds = new Set(view.asNeeded.map((m) => m.id));
      for (const id of asNeededIds) {
        expect(blockIds).not.toContain(id);
      }

      // 14.3 / 14.4 — every active med lands in EXACTLY its matching blocks
      // (multi-time meds in each block; no-time/PRN meds only in As Needed),
      // and nothing inactive leaks in.
      const blockOf = new Map(view.blocks.map((b) => [b.block, b]));
      for (const med of active) {
        const expected = expectedBlocks(med);
        const actual = new Set<TimeBlock>(
          [...blockOf.entries()]
            .filter(([, b]) => b.medications.some((m) => m.id === med.id))
            .map(([block]) => block),
        );
        expect(actual).toEqual(expected);

        if (expected.size === 0) {
          // No scheduled-time blocks → must be in As Needed (14.4).
          expect(asNeededIds.has(med.id)).toBe(true);
        } else {
          expect(asNeededIds.has(med.id)).toBe(false);
        }
      }

      // No inactive/deleted med appears anywhere in the view.
      const allViewIds = new Set([...blockIds, ...asNeededIds]);
      for (const id of allViewIds) {
        expect(activeIds.has(id)).toBe(true);
      }
    },
  );
});
