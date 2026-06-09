/**
 * Unit tests for symptom multi-tagging (associations).
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Association } from '@complex-patient/domain';
import {
  createSymptomAssociations,
  type AssociationLookups,
  type AssociationStore,
} from './index';

/**
 * In-memory AssociationStore standing in for the decrypted `associations`
 * partition. Models the read-modify-write the real Local_Vault/Crypto bridge
 * performs, and can be flipped to fail writes to exercise 16.5.
 */
class InMemoryAssociationStore implements AssociationStore {
  records: Association[] = [];
  writeCount = 0;
  failWrites = false;

  async readAssociations(): Promise<Association[]> {
    return this.records.map((r) => ({ ...r }));
  }

  async writeAssociations(records: Association[]): Promise<void> {
    if (this.failWrites) {
      throw new Error('vault write failed');
    }
    this.writeCount += 1;
    this.records = records.map((r) => ({ ...r }));
  }
}

/** Lookups backed by fixed known-id sets. */
function makeLookups(conditionIds: string[], medicationIds: string[]): AssociationLookups {
  return {
    async knownConditionIds() {
      return conditionIds;
    },
    async knownMedicationIds() {
      return medicationIds;
    },
  };
}

const FIXED_NOW = '2026-06-08T12:34:56.000Z';

function makeTagger(
  store: AssociationStore,
  lookups: AssociationLookups,
  ids: string[] = ['assoc-1', 'assoc-2'],
) {
  let i = 0;
  return createSymptomAssociations(store, lookups, {
    newId: () => ids[i++ % ids.length],
    now: () => FIXED_NOW,
  });
}

describe('saveAssociations — valid linking + persistence (16.1, 16.3, 16.4)', () => {
  let store: InMemoryAssociationStore;

  beforeEach(() => {
    store = new InMemoryAssociationStore();
  });

  it('links a symptom to existing conditions and persists to the associations partition', async () => {
    const lookups = makeLookups(['c1', 'c2', 'c3'], ['m1']);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['c1', 'c2'],
      medicationIds: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.association.id).toBe('assoc-1');
    expect(result.association.op_timestamp).toBe(FIXED_NOW);
    expect(result.association.symptomId).toBe('s1');
    expect(result.association.conditionIds).toEqual(['c1', 'c2']);
    expect(result.association.medicationIds).toEqual([]);

    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toEqual(result.association);
    expect(store.writeCount).toBe(1);
  });

  it('links a symptom flagged as adverse reaction to existing medications (16.3)', async () => {
    const lookups = makeLookups(['c1'], ['m1', 'm2']);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['c1'],
      medicationIds: ['m1', 'm2'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.association.medicationIds).toEqual(['m1', 'm2']);
    expect(store.records[0].medicationIds).toEqual(['m1', 'm2']);
  });

  it('appends to existing associations without dropping prior records', async () => {
    const lookups = makeLookups(['c1', 'c2'], []);
    const tagger = makeTagger(store, lookups, ['assoc-1', 'assoc-2']);

    await tagger.saveAssociations({ symptomId: 's1', conditionIds: ['c1'] });
    await tagger.saveAssociations({ symptomId: 's2', conditionIds: ['c2'] });

    expect(store.records).toHaveLength(2);
    expect(store.records.map((r) => r.id)).toEqual(['assoc-1', 'assoc-2']);
    expect(store.records.map((r) => r.symptomId)).toEqual(['s1', 's2']);
  });
});

describe('saveAssociations — cardinality bounds (16.1, 16.3)', () => {
  let store: InMemoryAssociationStore;

  beforeEach(() => {
    store = new InMemoryAssociationStore();
  });

  it('rejects when no conditions are linked (minimum 1)', async () => {
    const lookups = makeLookups(['c1'], []);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({ symptomId: 's1', conditionIds: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    expect(result.errors.some((e) => e.field === 'conditionIds')).toBe(true);
    expect(store.writeCount).toBe(0);
  });

  it('accepts exactly 50 conditions (upper bound)', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `c${i}`);
    const lookups = makeLookups(ids, []);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({ symptomId: 's1', conditionIds: ids });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.association.conditionIds).toHaveLength(50);
  });

  it('rejects 51 conditions (above upper bound)', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `c${i}`);
    const lookups = makeLookups(ids, []);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({ symptomId: 's1', conditionIds: ids });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'conditionIds')).toBe(true);
    expect(store.writeCount).toBe(0);
  });

  it('rejects 51 medications (above upper bound)', async () => {
    const condIds = ['c1'];
    const medIds = Array.from({ length: 51 }, (_, i) => `m${i}`);
    const lookups = makeLookups(condIds, medIds);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: condIds,
      medicationIds: medIds,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'medicationIds')).toBe(true);
    expect(store.writeCount).toBe(0);
  });
});

describe('saveAssociations — unknown-link rejection retains other associations (16.2)', () => {
  let store: InMemoryAssociationStore;

  beforeEach(() => {
    store = new InMemoryAssociationStore();
  });

  it('rejects a link to a non-existent condition with a not-found error', async () => {
    const lookups = makeLookups(['c1', 'c2'], []);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['c1', 'ghost'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    const condErr = result.errors.find((e) => e.field === 'conditionIds');
    expect(condErr?.message).toContain('ghost');
    expect(store.writeCount).toBe(0);
  });

  it('retains the user\'s other valid associations in the editing state', async () => {
    const lookups = makeLookups(['c1', 'c2'], ['m1']);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['c1', 'ghost', 'c2'],
      medicationIds: ['m1', 'missing-med'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // valid links retained, unknown ones dropped (16.2)
    expect(result.editing.symptomId).toBe('s1');
    expect(result.editing.conditionIds).toEqual(['c1', 'c2']);
    expect(result.editing.medicationIds).toEqual(['m1']);
    // both unknown links reported
    expect(result.errors.some((e) => e.message.includes('ghost'))).toBe(true);
    expect(result.errors.some((e) => e.message.includes('missing-med'))).toBe(true);
  });

  it('rejects a link to a non-existent medication with a not-found error', async () => {
    const lookups = makeLookups(['c1'], ['m1']);
    const tagger = makeTagger(store, lookups);

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['c1'],
      medicationIds: ['nope'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const medErr = result.errors.find((e) => e.field === 'medicationIds');
    expect(medErr?.message).toContain('nope');
    expect(store.writeCount).toBe(0);
  });
});

describe('saveAssociations — persistence failure retains editing state (16.5)', () => {
  let store: InMemoryAssociationStore;

  beforeEach(() => {
    store = new InMemoryAssociationStore();
  });

  it('retains unsaved associations and surfaces a not-saved error on write failure', async () => {
    const lookups = makeLookups(['c1', 'c2'], ['m1']);
    const tagger = makeTagger(store, lookups);
    store.failWrites = true;

    const result = await tagger.saveAssociations({
      symptomId: 's1',
      conditionIds: ['c1', 'c2'],
      medicationIds: ['m1'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('persistence');
    expect(result.errors.some((e) => e.field === 'associations')).toBe(true);
    // editing state retains all the valid entered associations (block progression)
    expect(result.editing.conditionIds).toEqual(['c1', 'c2']);
    expect(result.editing.medicationIds).toEqual(['m1']);
    expect(store.records).toHaveLength(0);
  });

  it('succeeds on retry once persistence recovers, clearing the blocked state', async () => {
    const lookups = makeLookups(['c1'], []);
    const tagger = makeTagger(store, lookups);
    store.failWrites = true;

    const failure = await tagger.saveAssociations({ symptomId: 's1', conditionIds: ['c1'] });
    expect(failure.ok).toBe(false);

    // Persistence recovers; retry from the retained editing state.
    store.failWrites = false;
    const retry = await tagger.saveAssociations({ symptomId: 's1', conditionIds: ['c1'] });

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(store.records).toHaveLength(1);
    expect(retry.association.conditionIds).toEqual(['c1']);
  });
});
