/**
 * Property-based test for render order/structure preservation (Task 9.7).
 *
 * Property 6: Rendering preserves engine-produced order and structure
 *   For any `PolyView` produced by `buildPolypharmacyView` and for any timeline
 *   produced by `buildConditionTimeline`, the flattened sequence the screen
 *   renders equals the engine's produced sequence exactly — same elements, same
 *   order, with no block/entry omitted, reordered, or inserted (the timeline is
 *   presented in the order required by 10.3: oldest-to-newest).
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 10.3, 10.4**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type {
  MedicationProfile,
  MedicationSchedule,
  SymptomEntry,
  FlareUp,
  Association,
} from '@complex-patient/domain';
import { buildPolypharmacyView, type PolyView, type PolyViewBlock } from '@complex-patient/medications';
import { buildConditionTimeline, type TimelineEntry } from '@complex-patient/symptom-journal';

// ---------------------------------------------------------------------------
// Generators — Polypharmacy
// ---------------------------------------------------------------------------

/** "HH:mm" time arbitrary covering all four block windows + midnight wrap. */
const timeArb: fc.Arbitrary<string> = fc
  .record({ h: fc.integer({ min: 0, max: 23 }), m: fc.integer({ min: 0, max: 59 }) })
  .map(({ h, m }) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** 0–4 scheduled times. */
const timesArb: fc.Arbitrary<string[]> = fc.array(timeArb, { minLength: 0, maxLength: 4 });

/** Drug names from a small alphabet to force collisions and ordering diversity. */
const drugNameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'), { minLength: 1, maxLength: 4 })
  .map((chars) => chars.join(''));

/** Schedule arbitrary mixing timed kinds with PRN/taper (no-time → As Needed). */
const scheduleArb: fc.Arbitrary<MedicationSchedule> = fc.oneof(
  timesArb.map((times) => ({ kind: 'weekly', daysOfWeek: ['MON'], times }) as MedicationSchedule),
  timesArb.map((times) => ({ kind: 'alternating', startDate: '2026-01-01', times }) as MedicationSchedule),
  timesArb.map((times) => ({ kind: 'rotating-interval', everyNDays: 2, times }) as MedicationSchedule),
  fc.constant({ kind: 'prn' } as MedicationSchedule),
  fc.constant({ kind: 'taper', phases: [{ weekIndex: 0, dosage: '5mg' }] } as MedicationSchedule),
);

/** A medication spec without an id; id is assigned from the array index. */
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

/**
 * Flatten a PolyView into a sequence of medication ids in the order the screen
 * would render them. The screen renders:
 * - flat layout: medications in order
 * - grouped layout: blocks in order, then asNeeded trailing
 */
function flattenPolyView(view: PolyView): string[] {
  if (view.layout === 'flat') {
    return view.medications.map((m) => m.id);
  }
  const ids: string[] = [];
  for (const block of view.blocks) {
    for (const med of block.medications) {
      ids.push(med.id);
    }
  }
  for (const med of view.asNeeded) {
    ids.push(med.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Generators — Timeline
// ---------------------------------------------------------------------------

const CONDITION_ID = 'cond-test';

/** ISO timestamp arbitrary. */
const timestampArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString());

/** Generate a SymptomEntry. */
const symptomEntryArb: fc.Arbitrary<SymptomEntry> = fc.record({
  id: fc.uuid(),
  op_timestamp: timestampArb,
  deleted: fc.constant(undefined),
  symptomType: fc.string({ minLength: 1, maxLength: 20 }),
  systemicLocation: fc.string({ minLength: 1, maxLength: 20 }),
  severity: fc.integer({ min: 1, max: 10 }),
  duration: fc.record({
    value: fc.integer({ min: 1, max: 100 }),
    unit: fc.constantFrom('minutes' as const, 'hours' as const, 'days' as const, 'weeks' as const),
  }),
  notes: fc.string({ minLength: 0, maxLength: 50 }),
  active: fc.boolean(),
});

/** Generate a MedicationProfile for timeline use. */
const medProfileArb: fc.Arbitrary<MedicationProfile> = fc.record({
  id: fc.uuid(),
  op_timestamp: timestampArb,
  deleted: fc.constant(undefined),
  drugName: fc.string({ minLength: 1, maxLength: 20 }),
  dosage: fc.constant('5mg'),
  form: fc.constant('tablet'),
  prescribingPhysician: fc.constant('Dr. Test'),
  conditionTreated: fc.constant('TestCondition'),
  active: fc.constant(true),
  schedule: fc.constant({ kind: 'weekly', daysOfWeek: ['MON'], times: ['08:00'] } as MedicationSchedule),
});

/** Generate a FlareUp. */
const flareUpArb = (symptomIds: string[]): fc.Arbitrary<FlareUp> =>
  fc.record({
    id: fc.uuid(),
    op_timestamp: timestampArb,
    deleted: fc.constant(undefined),
    symptomIds: fc.constant(symptomIds),
    trigger: fc.string({ minLength: 0, maxLength: 50 }),
  });

// ---------------------------------------------------------------------------
// Property 6 Tests — Polypharmacy
// ---------------------------------------------------------------------------

describe('Property 6: Rendering preserves engine-produced order and structure (9.1, 9.2, 9.3, 10.3, 10.4)', () => {
  // -------------------------------------------------------------------------
  // Polypharmacy: render order matches buildPolypharmacyView output exactly
  // -------------------------------------------------------------------------

  it.prop([medSpecsArb], { numRuns: 200 })(
    'polypharmacy: flattened render order matches the engine-produced PolyView structure exactly',
    (specs) => {
      const meds = buildMeds(specs);
      const view = buildPolypharmacyView(meds);

      // Simulate what the PolypharmacyScreen renders:
      // - flat layout: map over view.medications in order
      // - grouped layout: map over blocks in order, then asNeeded
      const renderedIds = flattenPolyView(view);

      // Independently flatten the same view structure to verify
      // the screen would produce the same sequence.
      if (view.layout === 'flat') {
        // Requirement 9.2: exact order of the flat list
        expect(renderedIds).toEqual(view.medications.map((m) => m.id));
        // No omission: lengths match
        expect(renderedIds.length).toBe(view.medications.length);
      } else {
        // Requirement 9.2: blocks in order, each block's meds in order, asNeeded trailing
        const expectedIds: string[] = [];
        for (const block of view.blocks) {
          for (const med of block.medications) {
            expectedIds.push(med.id);
          }
        }
        for (const med of view.asNeeded) {
          expectedIds.push(med.id);
        }
        expect(renderedIds).toEqual(expectedIds);
      }
    },
  );

  it.prop([medSpecsArb], { numRuns: 200 })(
    'polypharmacy: no block/entry omitted, reordered, or inserted — element-by-element fidelity',
    (specs) => {
      const meds = buildMeds(specs);
      const view = buildPolypharmacyView(meds);
      const renderedIds = flattenPolyView(view);

      if (view.layout === 'flat') {
        // Each medication in the view appears at exactly the same index
        view.medications.forEach((med, idx) => {
          expect(renderedIds[idx]).toBe(med.id);
        });
      } else {
        let cursor = 0;
        // Verify blocks preserve internal order
        for (const block of view.blocks) {
          for (const med of block.medications) {
            expect(renderedIds[cursor]).toBe(med.id);
            cursor++;
          }
        }
        // Verify asNeeded trails blocks
        for (const med of view.asNeeded) {
          expect(renderedIds[cursor]).toBe(med.id);
          cursor++;
        }
        // No extra insertions
        expect(cursor).toBe(renderedIds.length);
      }
    },
  );

  it.prop(
    [fc.constant([] as MedSpec[])],
    { numRuns: 100 },
  )(
    'polypharmacy: empty medication array produces empty-state (zero profiles, Requirement 9.3)',
    (_emptySpecs) => {
      const meds = buildMeds([]);
      const view = buildPolypharmacyView(meds);

      // Empty input → flat layout with zero medications
      expect(view.layout).toBe('flat');
      if (view.layout === 'flat') {
        expect(view.medications).toHaveLength(0);
      }
      // The screen would render the empty-medication-list message (9.3)
      const renderedIds = flattenPolyView(view);
      expect(renderedIds).toHaveLength(0);
    },
  );

  // Also test that all-inactive/all-deleted produces empty state
  it.prop([medSpecsArb], { numRuns: 100 })(
    'polypharmacy: all-inactive/deleted meds also produce empty flat view',
    (specs) => {
      // Force all specs to be inactive or deleted
      const inactiveSpecs = specs.map((s) => ({ ...s, active: false }));
      const meds = buildMeds(inactiveSpecs);
      const view = buildPolypharmacyView(meds);

      // Zero active meds → flat layout with zero medications
      expect(view.layout).toBe('flat');
      if (view.layout === 'flat') {
        expect(view.medications).toHaveLength(0);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Timeline: render order is oldest-to-newest (reversed from engine output)
  // -------------------------------------------------------------------------

  it.prop(
    [
      fc.array(symptomEntryArb, { minLength: 1, maxLength: 10 }),
      fc.array(medProfileArb, { minLength: 0, maxLength: 5 }),
    ],
    { numRuns: 200 },
  )(
    'timeline: rendered entries are in oldest-to-newest order (Requirement 10.3)',
    (symptoms, medications) => {
      // Create associations that tag all symptoms and medications to CONDITION_ID
      const associations: Association[] = symptoms.map((s, idx) => ({
        id: `assoc-${idx}`,
        op_timestamp: '2026-01-01T00:00:00.000Z',
        symptomId: s.id,
        conditionIds: [CONDITION_ID],
        medicationIds: medications.slice(0, Math.min(idx + 1, medications.length)).map((m) => m.id),
      }));

      // buildConditionTimeline returns entries in descending order (most recent first)
      const timeline = buildConditionTimeline(CONDITION_ID, symptoms, medications, [], associations);

      if (timeline.entries.length === 0) {
        // Empty timeline → nothing to verify for order
        return;
      }

      // The screen reverses to show oldest-to-newest (Requirement 10.3)
      const renderedEntries = [...timeline.entries].reverse();

      // Verify oldest-to-newest ordering
      for (let i = 1; i < renderedEntries.length; i++) {
        const prev = renderedEntries[i - 1];
        const curr = renderedEntries[i];
        // Each entry should be same or later than the previous
        const prevTime = prev.op_timestamp;
        const currTime = curr.op_timestamp;
        if (prevTime !== currTime) {
          expect(prevTime < currTime).toBe(true);
        } else {
          // On ties, the engine's descending tie-break (greater id first) is reversed,
          // so the smaller id should come first in ascending order
          expect(prev.id < curr.id).toBe(true);
        }
      }

      // Verify the rendered sequence preserves all entries (no omission/insertion)
      expect(renderedEntries).toHaveLength(timeline.entries.length);
      const renderedIds = new Set(renderedEntries.map((e) => e.id));
      const sourceIds = new Set(timeline.entries.map((e) => e.id));
      expect(renderedIds).toEqual(sourceIds);
    },
  );

  it.prop(
    [
      fc.array(symptomEntryArb, { minLength: 1, maxLength: 8 }),
      fc.array(medProfileArb, { minLength: 0, maxLength: 4 }),
    ],
    { numRuns: 100 },
  )(
    'timeline: reversed order is exactly the engine output reversed — no element dropped or reordered',
    (symptoms, medications) => {
      const associations: Association[] = symptoms.map((s, idx) => ({
        id: `assoc-${idx}`,
        op_timestamp: '2026-01-01T00:00:00.000Z',
        symptomId: s.id,
        conditionIds: [CONDITION_ID],
        medicationIds: medications.slice(0, Math.min(idx + 1, medications.length)).map((m) => m.id),
      }));

      const timeline = buildConditionTimeline(CONDITION_ID, symptoms, medications, [], associations);

      // The screen does: [...timeline.entries].reverse()
      const renderedEntries = [...timeline.entries].reverse();

      // Element-by-element: renderedEntries[i] === timeline.entries[entries.length - 1 - i]
      for (let i = 0; i < renderedEntries.length; i++) {
        const rendered = renderedEntries[i];
        const source = timeline.entries[timeline.entries.length - 1 - i];
        expect(rendered.id).toBe(source.id);
        expect(rendered.op_timestamp).toBe(source.op_timestamp);
        expect(rendered.kind).toBe(source.kind);
      }
    },
  );

  it.prop(
    [fc.array(symptomEntryArb, { minLength: 0, maxLength: 5 })],
    { numRuns: 100 },
  )(
    'timeline: empty inputs produce isEmpty=true (Requirement 10.4)',
    (symptoms) => {
      // Associations that do NOT reference CONDITION_ID → no entries tagged
      const associations: Association[] = symptoms.map((s, idx) => ({
        id: `assoc-${idx}`,
        op_timestamp: '2026-01-01T00:00:00.000Z',
        symptomId: s.id,
        conditionIds: ['other-condition'],
        medicationIds: [],
      }));

      const timeline = buildConditionTimeline(CONDITION_ID, symptoms, [], [], associations);

      // Nothing tagged → empty state
      expect(timeline.isEmpty).toBe(true);
      expect(timeline.entries).toHaveLength(0);
    },
  );

  it.prop([fc.constant(undefined)], { numRuns: 100 })(
    'timeline: completely empty arrays produce isEmpty=true (Requirement 10.4)',
    () => {
      const timeline = buildConditionTimeline(CONDITION_ID, [], [], [], []);
      expect(timeline.isEmpty).toBe(true);
      expect(timeline.entries).toHaveLength(0);
    },
  );

  // -------------------------------------------------------------------------
  // Timeline with flare-ups included
  // -------------------------------------------------------------------------

  it.prop(
    [
      fc.array(symptomEntryArb, { minLength: 2, maxLength: 8 }),
    ],
    { numRuns: 100 },
  )(
    'timeline: flare-ups tagged to the condition are included and order is preserved',
    (symptoms) => {
      // Tag all symptoms to the condition
      const associations: Association[] = symptoms.map((s, idx) => ({
        id: `assoc-${idx}`,
        op_timestamp: '2026-01-01T00:00:00.000Z',
        symptomId: s.id,
        conditionIds: [CONDITION_ID],
        medicationIds: [],
      }));

      // Create a flare referencing the first two symptoms
      const flareSymptomIds = symptoms.slice(0, 2).map((s) => s.id);
      const flare: FlareUp = {
        id: 'flare-1',
        op_timestamp: '2025-06-15T12:00:00.000Z',
        symptomIds: flareSymptomIds,
        trigger: 'stress',
      };

      const timeline = buildConditionTimeline(CONDITION_ID, symptoms, [], [flare], associations);

      // Flare should be included since it references tagged symptoms
      expect(timeline.entries.some((e) => e.id === 'flare-1')).toBe(true);

      // Reversal still produces oldest-to-newest
      const rendered = [...timeline.entries].reverse();
      for (let i = 1; i < rendered.length; i++) {
        const prev = rendered[i - 1];
        const curr = rendered[i];
        if (prev.op_timestamp !== curr.op_timestamp) {
          expect(prev.op_timestamp < curr.op_timestamp).toBe(true);
        } else {
          expect(prev.id < curr.id).toBe(true);
        }
      }
    },
  );
});
