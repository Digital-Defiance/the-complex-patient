/**
 * Unit tests for batch flare-up logging.
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FlareUp } from '@complex-patient/domain';
import { createFlareJournal, type FlareLookups, type FlareStore } from './index';

/**
 * In-memory FlareStore standing in for the decrypted `flares` partition. Models
 * the read-modify-write the real Local_Vault/Crypto bridge performs, and can be
 * flipped to fail writes to exercise 17.5.
 */
class InMemoryFlareStore implements FlareStore {
  records: FlareUp[] = [];
  writeCount = 0;
  failWrites = false;

  async readFlares(): Promise<FlareUp[]> {
    return this.records.map((r) => ({ ...r }));
  }

  async writeFlares(records: FlareUp[]): Promise<void> {
    if (this.failWrites) {
      throw new Error('vault write failed');
    }
    this.writeCount += 1;
    this.records = records.map((r) => ({ ...r }));
  }
}

/** Lookups backed by a fixed set of active symptom ids. */
function makeLookups(activeIds: string[]): FlareLookups {
  return {
    async activeSymptomIds() {
      return activeIds;
    },
  };
}

const FIXED_NOW = '2026-06-08T12:34:56.000Z';

function makeJournal(
  store: FlareStore,
  lookups: FlareLookups,
  ids: string[] = ['flare-1', 'flare-2'],
) {
  let i = 0;
  return createFlareJournal(store, lookups, {
    newId: () => ids[i++ % ids.length],
    now: () => FIXED_NOW,
  });
}

describe('logFlare — valid 2–50 active symptom creation + persistence (17.1, 17.2, 17.3)', () => {
  let store: InMemoryFlareStore;

  beforeEach(() => {
    store = new InMemoryFlareStore();
  });

  it('creates a flare from 2 active symptoms and persists references to the flares partition', async () => {
    const lookups = makeLookups(['s1', 's2', 's3']);
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({
      symptomIds: ['s1', 's2'],
      trigger: 'Weather change',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flare.id).toBe('flare-1');
    expect(result.flare.op_timestamp).toBe(FIXED_NOW);
    expect(result.flare.symptomIds).toEqual(['s1', 's2']);
    expect(result.flare.trigger).toBe('Weather change');

    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toEqual(result.flare);
    expect(store.writeCount).toBe(1);
  });

  it('accepts exactly 50 active symptoms (upper bound)', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `s${i}`);
    const lookups = makeLookups(ids);
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({ symptomIds: ids, trigger: '' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flare.symptomIds).toHaveLength(50);
  });

  it('rejects 51 symptoms (above upper bound) preserving selection', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `s${i}`);
    const lookups = makeLookups(ids);
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({ symptomIds: ids, trigger: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
    expect(result.editing.symptomIds).toHaveLength(51);
    expect(store.writeCount).toBe(0);
  });

  it('appends to existing flares without dropping prior records', async () => {
    const lookups = makeLookups(['s1', 's2', 's3', 's4']);
    const journal = makeJournal(store, lookups, ['flare-1', 'flare-2']);

    await journal.logFlare({ symptomIds: ['s1', 's2'], trigger: 'A' });
    await journal.logFlare({ symptomIds: ['s3', 's4'], trigger: 'B' });

    expect(store.records).toHaveLength(2);
    expect(store.records.map((r) => r.id)).toEqual(['flare-1', 'flare-2']);
  });

  it('restricts the batch selection to active symptoms, rejecting inactive ones (17.1)', async () => {
    const lookups = makeLookups(['s1', 's2']); // s3 is not active
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({
      symptomIds: ['s1', 's2', 's3'],
      trigger: 'Flare',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    const err = result.errors.find((e) => e.field === 'symptomIds');
    expect(err?.message).toContain('s3');
    // valid active selection retained, inactive dropped from editing state
    expect(result.editing.symptomIds).toEqual(['s1', 's2']);
    expect(store.writeCount).toBe(0);
  });
});

describe('logFlare — trigger length bound (17.2)', () => {
  let store: InMemoryFlareStore;

  beforeEach(() => {
    store = new InMemoryFlareStore();
  });

  it('accepts a trigger at exactly 500 characters', async () => {
    const lookups = makeLookups(['s1', 's2']);
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({
      symptomIds: ['s1', 's2'],
      trigger: 'x'.repeat(500),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flare.trigger).toHaveLength(500);
  });

  it('rejects a trigger over 500 characters preserving the selection', async () => {
    const lookups = makeLookups(['s1', 's2']);
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({
      symptomIds: ['s1', 's2'],
      trigger: 'x'.repeat(501),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    expect(result.errors.some((e) => e.field === 'trigger')).toBe(true);
    expect(result.editing.symptomIds).toEqual(['s1', 's2']);
    expect(result.editing.trigger).toHaveLength(501);
    expect(store.writeCount).toBe(0);
  });
});

describe('logFlare — fewer than 2 symptoms rejected preserving selection (17.4)', () => {
  let store: InMemoryFlareStore;

  beforeEach(() => {
    store = new InMemoryFlareStore();
  });

  it('rejects a single-symptom flare and preserves the selection', async () => {
    const lookups = makeLookups(['s1']);
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({ symptomIds: ['s1'], trigger: 'Trigger' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('validation');
    expect(result.errors.some((e) => e.field === 'symptomIds')).toBe(true);
    expect(result.editing.symptomIds).toEqual(['s1']);
    expect(result.editing.trigger).toBe('Trigger');
    expect(store.writeCount).toBe(0);
  });

  it('rejects an empty selection', async () => {
    const lookups = makeLookups([]);
    const journal = makeJournal(store, lookups);

    const result = await journal.logFlare({ symptomIds: [], trigger: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.editing.symptomIds).toEqual([]);
    expect(store.writeCount).toBe(0);
  });
});

describe('logFlare — storage failure retains data with an error (17.5)', () => {
  let store: InMemoryFlareStore;

  beforeEach(() => {
    store = new InMemoryFlareStore();
  });

  it('retains the entered data and surfaces a not-saved error on write failure', async () => {
    const lookups = makeLookups(['s1', 's2']);
    const journal = makeJournal(store, lookups);
    store.failWrites = true;

    const result = await journal.logFlare({
      symptomIds: ['s1', 's2'],
      trigger: 'Heat',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toBe('persistence');
    expect(result.errors.some((e) => e.field === 'flare')).toBe(true);
    // data retained for retry (17.5)
    expect(result.editing.symptomIds).toEqual(['s1', 's2']);
    expect(result.editing.trigger).toBe('Heat');
    expect(store.records).toHaveLength(0);
  });

  it('succeeds on retry once storage recovers', async () => {
    const lookups = makeLookups(['s1', 's2']);
    const journal = makeJournal(store, lookups);
    store.failWrites = true;

    const failure = await journal.logFlare({ symptomIds: ['s1', 's2'], trigger: 'Heat' });
    expect(failure.ok).toBe(false);

    store.failWrites = false;
    const retry = await journal.logFlare({ symptomIds: ['s1', 's2'], trigger: 'Heat' });

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(store.records).toHaveLength(1);
    expect(retry.flare.symptomIds).toEqual(['s1', 's2']);
  });
});
