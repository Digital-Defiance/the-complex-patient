/**
 * Property-based tests for the condition timeline projection (symptom-journal).
 *
 * Property 16: Condition timeline ordering determinism
 *
 * For any set of symptoms, medications, flare-ups, and associations,
 * `buildConditionTimeline` returns only entries tagged to the condition,
 * ordered by `op_timestamp` descending with ties broken by the
 * lexicographically greater id, producing a total, deterministic order
 * (identical inputs always produce identical output).
 *
 * **Validates: Requirements 18.1, 18.2, 18.3**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type {
  Association,
  FlareUp,
  MedicationProfile,
  SymptomEntry,
} from '@complex-patient/domain';
import { buildConditionTimeline } from './index';

// ---------------------------------------------------------------------------
// Generators
//
// Deliberately small id/condition/timestamp pools so that tagging overlaps and
// equal-timestamp ties (18.3) occur with high probability across runs.
// ---------------------------------------------------------------------------

const CONDITION_ID = 'c1';
// A second condition so some associations tag a *different* condition, forcing
// the "exclude untagged" path (18.1) to be exercised.
const CONDITION_POOL = [CONDITION_ID, 'c2'] as const;

const SYMPTOM_ID_POOL = ['s1', 's2', 's3', 's4'] as const;
const MED_ID_POOL = ['m1', 'm2', 'm3'] as const;
const FLARE_ID_POOL = ['f1', 'f2', 'f3'] as const;
const ASSOC_ID_POOL = ['a1', 'a2', 'a3', 'a4', 'a5'] as const;

// A small timestamp space so equal-timestamp ties are common.
const opTimestampArb = fc
  .integer({ min: 1, max: 4 })
  .map((d) => `2024-01-0${d}T00:00:00Z`);

function symptomArb(id: string): fc.Arbitrary<SymptomEntry> {
  return opTimestampArb.map((op_timestamp) => ({
    id,
    op_timestamp,
    symptomType: 'fatigue',
    systemicLocation: 'whole-body',
    severity: 5,
    duration: { value: 2, unit: 'hours' },
    notes: '',
    active: true,
  }));
}

function medicationArb(id: string): fc.Arbitrary<MedicationProfile> {
  return opTimestampArb.map((op_timestamp) => ({
    id,
    op_timestamp,
    drugName: 'Drug ' + id,
    dosage: '10mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Who',
    conditionTreated: 'POTS',
    active: true,
    schedule: { kind: 'prn' },
  }));
}

function flareArb(id: string): fc.Arbitrary<FlareUp> {
  return fc
    .record({
      op_timestamp: opTimestampArb,
      // 1–3 symptom ids drawn from the shared pool (may include untagged ids).
      symptomIds: fc.uniqueArray(fc.constantFrom(...SYMPTOM_ID_POOL), {
        minLength: 1,
        maxLength: SYMPTOM_ID_POOL.length,
      }),
    })
    .map(({ op_timestamp, symptomIds }) => ({ id, op_timestamp, symptomIds, trigger: 'heat' }));
}

function associationArb(id: string): fc.Arbitrary<Association> {
  return fc
    .record({
      symptomId: fc.constantFrom(...SYMPTOM_ID_POOL),
      conditionIds: fc.uniqueArray(fc.constantFrom(...CONDITION_POOL), {
        minLength: 1,
        maxLength: CONDITION_POOL.length,
      }),
      medicationIds: fc.uniqueArray(fc.constantFrom(...MED_ID_POOL), {
        minLength: 0,
        maxLength: MED_ID_POOL.length,
      }),
    })
    .map(({ symptomId, conditionIds, medicationIds }) => ({
      id,
      op_timestamp: '2024-01-01T00:00:00Z',
      symptomId,
      conditionIds,
      medicationIds,
    }));
}

/** Generate a set of records with unique ids drawn from a fixed pool. */
function setArb<T>(
  pool: readonly string[],
  arbFor: (id: string) => fc.Arbitrary<T>,
): fc.Arbitrary<T[]> {
  return fc
    .tuple(...pool.map((id) => fc.option(arbFor(id), { nil: undefined })))
    .map((entries) => entries.filter((r): r is T => r !== undefined));
}

const symptomsArb = setArb(SYMPTOM_ID_POOL, symptomArb);
const medsArb = setArb(MED_ID_POOL, medicationArb);
const flaresArb = setArb(FLARE_ID_POOL, flareArb);
const assocArb = setArb(ASSOC_ID_POOL, associationArb);

// ---------------------------------------------------------------------------
// Helpers — recompute "tagged to condition" independently of the implementation
// ---------------------------------------------------------------------------

function expectedTaggedIds(
  symptoms: readonly SymptomEntry[],
  meds: readonly MedicationProfile[],
  flares: readonly FlareUp[],
  assoc: readonly Association[],
): Set<string> {
  const forCondition = assoc.filter((a) => a.conditionIds.includes(CONDITION_ID));
  const taggedSymptomIds = new Set<string>();
  const taggedMedicationIds = new Set<string>();
  for (const a of forCondition) {
    taggedSymptomIds.add(a.symptomId);
    for (const m of a.medicationIds) taggedMedicationIds.add(m);
  }

  const tagged = new Set<string>();
  for (const s of symptoms) if (taggedSymptomIds.has(s.id)) tagged.add(s.id);
  for (const m of meds) if (taggedMedicationIds.has(m.id)) tagged.add(m.id);
  for (const f of flares) {
    if (f.symptomIds.some((sid) => taggedSymptomIds.has(sid))) tagged.add(f.id);
  }
  return tagged;
}

// ---------------------------------------------------------------------------
// Property 16: Condition timeline ordering determinism
// **Validates: Requirements 18.1, 18.2, 18.3**
// ---------------------------------------------------------------------------

describe('Property 16: Condition timeline ordering determinism', () => {
  it.prop([symptomsArb, medsArb, flaresArb, assocArb], { numRuns: 500 })(
    'returns only tagged entries in a total, deterministic op_timestamp-DESC / id-tie-break order',
    (symptoms, meds, flares, assoc) => {
      const timeline = buildConditionTimeline(CONDITION_ID, symptoms, meds, flares, assoc);

      // (a) Only tagged entries appear, and every tagged entry appears exactly
      //     once — nothing untagged leaks in, nothing tagged is dropped (18.1).
      const resultIds = timeline.entries.map((e) => e.id);
      const expected = expectedTaggedIds(symptoms, meds, flares, assoc);
      expect(new Set(resultIds)).toEqual(expected);
      expect(resultIds.length).toBe(expected.size); // no duplicates
      expect(timeline.isEmpty).toBe(expected.size === 0);

      // (b) Total order: every adjacent pair satisfies op_timestamp DESC, with
      //     ties broken by lexicographically GREATER id (18.2, 18.3). Because
      //     ids are unique, the relation is strict, hence a total order.
      for (let i = 0; i + 1 < timeline.entries.length; i++) {
        const cur = timeline.entries[i];
        const next = timeline.entries[i + 1];
        if (cur.op_timestamp === next.op_timestamp) {
          // Tie: earlier element has the lexicographically greater id.
          expect(cur.id > next.id).toBe(true);
        } else {
          // Most recent first.
          expect(cur.op_timestamp > next.op_timestamp).toBe(true);
        }
      }

      // (c) Determinism: identical inputs always produce identical output.
      const again = buildConditionTimeline(CONDITION_ID, symptoms, meds, flares, assoc);
      expect(again).toEqual(timeline);
    },
  );
});
