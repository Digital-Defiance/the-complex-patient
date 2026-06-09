/**
 * Unit tests for symptom logging with draft retention.
 *
 * Validates: Requirements 15.1, 15.2, 15.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SymptomEntry } from '@complex-patient/domain';
import { createSymptomJournal, type SymptomStore } from './index';

/**
 * In-memory SymptomStore standing in for the decrypted `symptoms` partition.
 * Models the read-modify-write the real Local_Vault/Crypto bridge performs,
 * without any crypto/storage runtime.
 */
class InMemorySymptomStore implements SymptomStore {
  records: SymptomEntry[] = [];
  writeCount = 0;

  async readSymptoms(): Promise<SymptomEntry[]> {
    // Return a copy so callers can't mutate internal state directly.
    return this.records.map((r) => ({ ...r }));
  }

  async writeSymptoms(records: SymptomEntry[]): Promise<void> {
    this.writeCount += 1;
    this.records = records.map((r) => ({ ...r }));
  }
}

const FIXED_NOW = '2026-06-08T12:34:56.000Z';

function makeJournal(store: SymptomStore, ids: string[] = ['id-1', 'id-2', 'id-3']) {
  let i = 0;
  return createSymptomJournal(store, {
    newId: () => ids[i++ % ids.length],
    now: () => FIXED_NOW,
  });
}

describe('logSymptom — valid entry storage (15.1, 15.2)', () => {
  let store: InMemorySymptomStore;

  beforeEach(() => {
    store = new InMemorySymptomStore();
  });

  it('stores a fully valid symptom entry in the symptoms partition with op_timestamp', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Migraine',
      systemicLocation: 'Head',
      severity: 7,
      duration: { value: 3, unit: 'hours' },
      notes: 'Throbbing behind left eye',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // op_timestamp stamped from the client-side clock (15.2)
    expect(result.entry.op_timestamp).toBe(FIXED_NOW);
    expect(result.entry.id).toBe('id-1');

    // all required fields recorded as a single entry (15.1)
    expect(result.entry.symptomType).toBe('Migraine');
    expect(result.entry.systemicLocation).toBe('Head');
    expect(result.entry.severity).toBe(7);
    expect(result.entry.duration).toEqual({ value: 3, unit: 'hours' });
    expect(result.entry.notes).toBe('Throbbing behind left eye');
    expect(result.entry.active).toBe(true);

    // persisted into the partition record set (15.2)
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toEqual(result.entry);
  });

  it('appends to existing records without dropping prior entries', async () => {
    const journal = makeJournal(store, ['id-1', 'id-2']);

    await journal.logSymptom({
      symptomType: 'Nausea',
      systemicLocation: 'Stomach',
      severity: 4,
      duration: { value: 30, unit: 'minutes' },
    });
    await journal.logSymptom({
      symptomType: 'Fatigue',
      systemicLocation: 'Whole body',
      severity: 6,
      duration: { value: 2, unit: 'days' },
    });

    expect(store.records).toHaveLength(2);
    expect(store.records.map((r) => r.symptomType)).toEqual(['Nausea', 'Fatigue']);
    expect(store.records.map((r) => r.id)).toEqual(['id-1', 'id-2']);
  });

  it('defaults notes to empty string and active to true when omitted', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Dizziness',
      systemicLocation: 'Head',
      severity: 5,
      duration: { value: 10, unit: 'minutes' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.notes).toBe('');
    expect(result.entry.active).toBe(true);
  });

  it('honors an explicit active=false flag', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Joint pain',
      systemicLocation: 'Knees',
      severity: 3,
      duration: { value: 1, unit: 'weeks' },
      active: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.active).toBe(false);
  });

  it('trims surrounding whitespace from text identity fields', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: '  Migraine  ',
      systemicLocation: '  Head  ',
      severity: 8,
      duration: { value: 5, unit: 'hours' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.symptomType).toBe('Migraine');
    expect(result.entry.systemicLocation).toBe('Head');
  });
});

describe('logSymptom — draft retention on validation rejection (15.6)', () => {
  let store: InMemorySymptomStore;

  beforeEach(() => {
    store = new InMemorySymptomStore();
  });

  it('does not persist anything when validation fails', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: '',
      systemicLocation: '',
      severity: 0,
      duration: undefined,
    });

    expect(result.ok).toBe(false);
    expect(store.records).toHaveLength(0);
    expect(store.writeCount).toBe(0);
  });

  it('retains entered details as a draft when symptom type is missing', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: '',
      systemicLocation: 'Head',
      severity: 6,
      duration: { value: 2, unit: 'hours' },
      notes: 'partial entry',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'symptomType')).toBe(true);
    // captured info preserved so it is not lost (15.6) — including the empty field
    expect(result.draft).toEqual({
      symptomType: '',
      systemicLocation: 'Head',
      severity: 6,
      duration: { value: 2, unit: 'hours' },
      notes: 'partial entry',
    });
  });

  it('retains entered details as a draft when systemic location is missing', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Rash',
      systemicLocation: '   ',
      severity: 2,
      duration: { value: 1, unit: 'days' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'systemicLocation')).toBe(true);
    expect(result.draft.symptomType).toBe('Rash');
    // whitespace-only location is still captured verbatim in the draft
    expect(result.draft.systemicLocation).toBe('   ');
    expect(result.draft.severity).toBe(2);
    expect(result.draft.duration).toEqual({ value: 1, unit: 'days' });
  });

  it('retains entered details as a draft when severity is out of range', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Headache',
      systemicLocation: 'Head',
      severity: 11,
      duration: { value: 4, unit: 'hours' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    expect(result.draft.severity).toBe(11);
    expect(result.draft.symptomType).toBe('Headache');
  });

  it('retains entered details as a draft when severity is not an integer', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Headache',
      systemicLocation: 'Head',
      severity: 5.5,
      duration: { value: 4, unit: 'hours' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'severity')).toBe(true);
    expect(result.draft.severity).toBe(5.5);
  });

  it('retains entered details as a draft when duration is missing', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Cramp',
      systemicLocation: 'Leg',
      severity: 4,
      duration: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'duration')).toBe(true);
    expect(result.draft.symptomType).toBe('Cramp');
    expect(result.draft.systemicLocation).toBe('Leg');
    expect(result.draft.severity).toBe(4);
    expect(result.draft.duration).toBeUndefined();
  });

  it('retains partial duration (value only) as a draft when unit is invalid', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: 'Cramp',
      systemicLocation: 'Leg',
      severity: 4,
      duration: { value: 15, unit: 'fortnights' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'duration.unit')).toBe(true);
    expect(result.draft.duration).toEqual({ value: 15 });
  });

  it('retains entered details as a draft when notes exceed 2000 characters', async () => {
    const journal = makeJournal(store);
    const longNotes = 'a'.repeat(2001);

    const result = await journal.logSymptom({
      symptomType: 'Pain',
      systemicLocation: 'Back',
      severity: 5,
      duration: { value: 1, unit: 'hours' },
      notes: longNotes,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'notes')).toBe(true);
    expect(result.draft.notes).toBe(longNotes);
    expect(store.records).toHaveLength(0);
  });

  it('returns all field errors and a full draft when multiple fields are invalid', async () => {
    const journal = makeJournal(store);

    const result = await journal.logSymptom({
      symptomType: '',
      systemicLocation: '',
      severity: 99,
      duration: { value: -1, unit: 'years' },
      notes: 'x',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain('symptomType');
    expect(fields).toContain('systemicLocation');
    expect(fields).toContain('severity');
    expect(fields).toContain('duration.value');
    expect(fields).toContain('duration.unit');
    // draft still captures whatever was entered (15.6)
    expect(result.draft.severity).toBe(99);
    expect(result.draft.notes).toBe('x');
    expect(store.records).toHaveLength(0);
  });
});
