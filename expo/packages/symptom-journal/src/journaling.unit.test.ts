/**
 * Consolidated cross-cutting unit tests for the Symptom_Journal subsystems.
 *
 * This suite complements the per-feature test files (journal.test.ts,
 * associations.test.ts, flares.test.ts, timeline.test.ts) by exercising the
 * boundary and edge cases that span the journaling subsystems rather than
 * trivially re-asserting their happy paths:
 *
 * - draft retention on rejection drops non-representable field types while
 *   keeping the user's other entered values (15.6);
 * - association cardinality lower-bound acceptance, all-unknown rejection
 *   yielding an empty retained selection, and de-duplication not inflating
 *   cardinality (16.1, 16.2);
 * - the flare minimum-symptom 1-vs-2 boundary interacting with the active
 *   filter and de-duplication while preserving the selection (17.4);
 * - timeline empty-state when nothing is tagged at all and when associations
 *   reference records that are absent from the partition (18.4).
 *
 * Validates: Requirements 15.6, 16.2, 17.4, 18.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Association,
  FlareUp,
  MedicationProfile,
  SymptomEntry,
} from '@complex-patient/domain';
import {
  buildConditionTimeline,
  createFlareJournal,
  createSymptomAssociations,
  createSymptomJournal,
  type AssociationLookups,
  type AssociationStore,
  type FlareLookups,
  type FlareStore,
  type SymptomStore,
} from './index';

const FIXED_NOW = '2026-06-08T12:34:56.000Z';

/* --------------------------- in-memory stores ---------------------------- */

class InMemorySymptomStore implements SymptomStore {
  records: SymptomEntry[] = [];
  writeCount = 0;
  async readSymptoms(): Promise<SymptomEntry[]> {
    return this.records.map((r) => ({ ...r }));
  }
  async writeSymptoms(records: SymptomEntry[]): Promise<void> {
    this.writeCount += 1;
    this.records = records.map((r) => ({ ...r }));
  }
}

class InMemoryAssociationStore implements AssociationStore {
  records: Association[] = [];
  writeCount = 0;
  async readAssociations(): Promise<Association[]> {
    return this.records.map((r) => ({ ...r }));
  }
  async writeAssociations(records: Association[]): Promise<void> {
    this.writeCount += 1;
    this.records = records.map((r) => ({ ...r }));
  }
}

class InMemoryFlareStore implements FlareStore {
  records: FlareUp[] = [];
  writeCount = 0;
  async readFlares(): Promise<FlareUp[]> {
    return this.records.map((r) => ({ ...r }));
  }
  async writeFlares(records: FlareUp[]): Promise<void> {
    this.writeCount += 1;
    this.records = records.map((r) => ({ ...r }));
  }
}

function makeConditionLookups(conditionIds: string[], medicationIds: string[]): AssociationLookups {
  return {
    async knownConditionIds() {
      return conditionIds;
    },
    async knownMedicationIds() {
      return medicationIds;
    },
  };
}

function makeFlareLookups(activeIds: string[]): FlareLookups {
  return {
    async activeSymptomIds() {
      return activeIds;
    },
  };
}

/* ============================ 15.6 draft edges ============================ */

describe('draft retention on rejection — malformed field types (15.6)', () => {
  let store: InMemorySymptomStore;

  beforeEach(() => {
    store = new InMemorySymptomStore();
  });

  function makeJournal() {
    return createSymptomJournal(store, { newId: () => 'id-1', now: () => FIXED_NOW });
  }

  it('omits non-string identity fields from the draft while retaining valid ones, persisting nothing', async () => {
    const journal = makeJournal();

    const result = await journal.logSymptom({
      // malformed types the user could never have typed as text fields
      symptomType: 42 as unknown,
      systemicLocation: 'Head',
      severity: 'high' as unknown,
      duration: { value: 3, unit: 'hours' },
      notes: 'kept note',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // non-representable fields are dropped from the draft shape...
    expect(result.draft.symptomType).toBeUndefined();
    expect(result.draft.severity).toBeUndefined();
    // ...but the user's valid entries survive (15.6)
    expect(result.draft.systemicLocation).toBe('Head');
    expect(result.draft.duration).toEqual({ value: 3, unit: 'hours' });
    expect(result.draft.notes).toBe('kept note');
    // nothing persisted on rejection
    expect(store.records).toHaveLength(0);
    expect(store.writeCount).toBe(0);
  });

  it('retains an entirely empty draft when no field is representable', async () => {
    const journal = makeJournal();

    const result = await journal.logSymptom({
      symptomType: undefined,
      systemicLocation: undefined,
      severity: undefined,
      duration: undefined,
      notes: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.draft).toEqual({});
    expect(store.writeCount).toBe(0);
  });

  it('captures a boundary-valid severity in the draft when another field forces rejection', async () => {
    const journal = makeJournal();

    // severity 1 and 10 are the valid integer extremes; the entry is rejected
    // only because the location is missing, so the boundary value is retained.
    for (const severity of [1, 10]) {
      const result = await journal.logSymptom({
        symptomType: 'Ache',
        systemicLocation: '',
        severity,
        duration: { value: 1, unit: 'days' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.draft.severity).toBe(severity);
    }
    expect(store.writeCount).toBe(0);
  });
});

/* ===================== 16.1/16.2 association edges ======================= */

describe('association cardinality + unknown-condition edges (16.1, 16.2)', () => {
  let store: InMemoryAssociationStore;

  beforeEach(() => {
    store = new InMemoryAssociationStore();
  });

  function makeTagger(lookups: AssociationLookups) {
    return createSymptomAssociations(store, lookups, {
      newId: () => 'assoc-1',
      now: () => FIXED_NOW,
    });
  }

  it('accepts exactly 1 condition (lower cardinality bound)', async () => {
    const tagger = makeTagger(makeConditionLookups(['c1'], []));

    const result = await tagger.saveAssociations({ symptomId: 's1', conditionIds: ['c1'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.association.conditionIds).toEqual(['c1']);
    expect(store.records).toHaveLength(1);
  });

  it('rejects with an empty retained selection when every entered condition is unknown (16.2)', async () => {
    const tagger = makeTagger(makeConditionLookups(['c1', 'c2'], []));

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['ghost-a', 'ghost-b'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    // both unknown links reported by id
    expect(result.errors.filter((e) => e.field === 'conditionIds')).toHaveLength(2);
    expect(result.errors.some((e) => e.message.includes('ghost-a'))).toBe(true);
    expect(result.errors.some((e) => e.message.includes('ghost-b'))).toBe(true);
    // nothing valid remains in the editing state, anchor symptom preserved
    expect(result.editing.symptomId).toBe('s1');
    expect(result.editing.conditionIds).toEqual([]);
    expect(store.writeCount).toBe(0);
  });

  it('de-duplicates repeated condition ids so duplicates do not inflate cardinality past 50', async () => {
    // 50 unique known ids plus duplicates of some of them — must still be valid.
    const unique = Array.from({ length: 50 }, (_, i) => `c${i}`);
    const tagger = makeTagger(makeConditionLookups(unique, []));

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: [...unique, 'c0', 'c1', 'c2'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.association.conditionIds).toHaveLength(50);
    expect(new Set(result.association.conditionIds).size).toBe(50);
  });

  it('keeps the known conditions while rejecting only the unknown one, persisting nothing', async () => {
    const tagger = makeTagger(makeConditionLookups(['c1', 'c2'], ['m1']));

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['c1', 'ghost', 'c2'],
      medicationIds: ['m1'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.editing.conditionIds).toEqual(['c1', 'c2']);
    expect(result.editing.medicationIds).toEqual(['m1']);
    expect(store.records).toHaveLength(0);
    expect(store.writeCount).toBe(0);
  });
});

/* ===================== 17.4 flare minimum-symptom edge ==================== */

describe('flare minimum-symptom 1-vs-2 boundary preserving selection (17.4)', () => {
  let store: InMemoryFlareStore;

  beforeEach(() => {
    store = new InMemoryFlareStore();
  });

  function makeJournal(lookups: FlareLookups) {
    return createFlareJournal(store, lookups, { newId: () => 'flare-1', now: () => FIXED_NOW });
  }

  it('rejects exactly 1 active symptom but accepts exactly 2 (the minimum boundary)', async () => {
    // 1 active → rejected
    const one = await makeJournal(makeFlareLookups(['s1'])).logFlare({
      symptomIds: ['s1'],
      trigger: 'one',
    });
    expect(one.ok).toBe(false);
    if (one.ok) return;
    expect(one.errors.some((e) => e.field === 'symptomIds')).toBe(true);
    expect(one.editing.symptomIds).toEqual(['s1']);
    expect(store.writeCount).toBe(0);

    // 2 active → accepted
    const two = await makeJournal(makeFlareLookups(['s1', 's2'])).logFlare({
      symptomIds: ['s1', 's2'],
      trigger: 'two',
    });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.flare.symptomIds).toEqual(['s1', 's2']);
    expect(store.writeCount).toBe(1);
  });

  it('rejects when the active filter drops a 2-symptom selection below the minimum, preserving the active one', async () => {
    // user picked s1 + s2 but only s1 is currently active → effective count is 1
    const journal = makeJournal(makeFlareLookups(['s1']));

    const result = await journal.logFlare({ symptomIds: ['s1', 's2'], trigger: 'mixed' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    // both the inactive-symptom error and the below-minimum error surface
    expect(result.errors.some((e) => e.message.includes('s2'))).toBe(true);
    expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
    // the retained editing selection keeps only the active symptom and the trigger
    expect(result.editing.symptomIds).toEqual(['s1']);
    expect(result.editing.trigger).toBe('mixed');
    expect(store.writeCount).toBe(0);
  });

  it('rejects when duplicate ids collapse below the minimum after de-duplication', async () => {
    const journal = makeJournal(makeFlareLookups(['s1']));

    const result = await journal.logFlare({ symptomIds: ['s1', 's1'], trigger: 'dup' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.editing.symptomIds).toEqual(['s1']);
    expect(store.writeCount).toBe(0);
  });
});

/* ======================= 18.4 timeline empty-state ======================= */

describe('condition timeline empty-state (18.4)', () => {
  function symptom(id: string, ts: string): SymptomEntry {
    return {
      id,
      op_timestamp: ts,
      symptomType: 'fatigue',
      systemicLocation: 'whole-body',
      severity: 5,
      duration: { value: 2, unit: 'hours' },
      notes: '',
      active: true,
    };
  }
  function medication(id: string, ts: string): MedicationProfile {
    return {
      id,
      op_timestamp: ts,
      drugName: 'Drug ' + id,
      dosage: '10mg',
      form: 'tablet',
      prescribingPhysician: 'Dr. Who',
      conditionTreated: 'POTS',
      active: true,
      schedule: { kind: 'prn' },
    };
  }
  function association(
    id: string,
    symptomId: string,
    conditionIds: string[],
    medicationIds: string[] = [],
  ): Association {
    return { id, op_timestamp: '2024-01-01T00:00:00Z', symptomId, conditionIds, medicationIds };
  }

  it('reports empty-state with no entries when nothing is tagged at all (no associations)', () => {
    const symptoms = [symptom('s1', '2024-01-01T00:00:00Z')];
    const meds = [medication('m1', '2024-01-02T00:00:00Z')];

    const timeline = buildConditionTimeline('c1', symptoms, meds, [], []);

    expect(timeline.conditionId).toBe('c1');
    expect(timeline.entries).toEqual([]);
    expect(timeline.isEmpty).toBe(true);
  });

  it('reports empty-state with fully empty inputs', () => {
    const timeline = buildConditionTimeline('c1', [], [], [], []);
    expect(timeline.entries).toEqual([]);
    expect(timeline.isEmpty).toBe(true);
  });

  it('reports empty-state when an association tags the condition but references absent records', () => {
    // association links symptom "s-missing" + medication "m-missing" to c1, but
    // neither record exists in the partition → nothing projects → empty-state.
    const assoc = [association('a1', 's-missing', ['c1'], ['m-missing'])];

    const timeline = buildConditionTimeline('c1', [], [], [], assoc);

    expect(timeline.entries).toEqual([]);
    expect(timeline.isEmpty).toBe(true);
  });

  it('leaves empty-state set for a condition whose only associations belong to other conditions', () => {
    const symptoms = [symptom('s1', '2024-01-01T00:00:00Z')];
    const assoc = [association('a1', 's1', ['other-1', 'other-2'])];

    const timeline = buildConditionTimeline('c1', symptoms, [], [], assoc);

    expect(timeline.isEmpty).toBe(true);
    expect(timeline.entries).toEqual([]);
  });

  it('clears empty-state as soon as a single tagged record resolves', () => {
    const symptoms = [symptom('s1', '2024-01-01T00:00:00Z')];
    const assoc = [association('a1', 's1', ['c1'])];

    const timeline = buildConditionTimeline('c1', symptoms, [], [], assoc);

    expect(timeline.isEmpty).toBe(false);
    expect(timeline.entries.map((e) => e.id)).toEqual(['s1']);
  });
});
