import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type {
  MedicationProfile,
  MedicationSchedule,
  PrnConfig,
} from '@complex-patient/domain';
import { MedicationProfileEngine } from './index';
import type { MedicationProfileInput, VaultCrypto } from './index';

/**
 * Unit/integration tests for medication profile CRUD (Task 11.1).
 *
 * These exercise the real Crypto_Engine (AES-256-GCM via node:crypto) and the
 * real EncryptedLocalVault over an in-memory backend — no mocks — so the tests
 * validate the actual encrypt → persist → decrypt round-trip.
 *
 * Coverage:
 * - create stores a validated profile in the medications partition (10.1, 10.3, 11.5)
 * - create rejects invalid profiles per-field without storing (10.2)
 * - create rejects invalid schedules without storing (11.4/11.5)
 * - update edits an existing profile in the Local_Vault (10.4)
 * - update records op_timestamp on update (10.5)
 * - update rejects edits to non-existent profiles leaving records unchanged (10.6)
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(7));

const crypto: VaultCrypto = { encrypt, decrypt };

/** A deterministic id factory for predictable assertions. */
function sequentialIds(): () => string {
  let n = 0;
  return () => `med-${++n}`;
}

/** A controllable clock so op_timestamp changes are observable. */
function controllableClock(): { now: () => string; set: (v: string) => void } {
  let value = '2026-01-01T00:00:00.000Z';
  return {
    now: () => value,
    set: (v: string) => {
      value = v;
    },
  };
}

const weeklySchedule: MedicationSchedule = {
  kind: 'weekly',
  daysOfWeek: ['MON', 'WED', 'FRI'],
  times: ['08:00'],
};

function makeInput(overrides: Partial<MedicationProfileInput> & { dosage?: string; form?: string; schedule?: MedicationSchedule; prn?: PrnConfig } = {}): MedicationProfileInput {
  const {
    dosage = '15mg',
    form = 'tablet',
    schedule = weeklySchedule,
    prn,
    regimens,
    ...rest
  } = overrides;

  return {
    drugName: 'Methotrexate',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'Rheumatoid Arthritis',
    active: true,
    regimens:
      regimens ??
      [
        {
          id: 'reg-1',
          dosage,
          form,
          schedule,
          ...(prn !== undefined ? { prn } : {}),
        },
      ],
    ...rest,
  };
}

let vault: LocalVault;
let backend: MemoryStorageBackend;

beforeEach(async () => {
  backend = new MemoryStorageBackend();
  vault = await createLocalVault(backend);
});

function makeEngine(opts: { now?: () => string; newId?: () => string } = {}) {
  return new MedicationProfileEngine({
    store: vault,
    crypto,
    kek: KEY,
    newId: opts.newId ?? sequentialIds(),
    now: opts.now,
  });
}

describe('MedicationProfileEngine.create — valid profiles (10.1, 10.3, 11.5)', () => {
  it('records all five fields as a single profile and stores it in the medications partition', async () => {
    const engine = makeEngine();
    const result = await engine.create(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({
      id: 'med-1',
      drugName: 'Methotrexate',
      prescribingPhysician: 'Dr. Smith',
      conditionTreated: 'Rheumatoid Arthritis',
      active: true,
      regimens: [
        expect.objectContaining({
          dosage: '15mg',
          form: 'tablet',
          schedule: weeklySchedule,
        }),
      ],
    });

    // Persisted and readable back from the vault.
    const stored = await engine.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('med-1');
  });

  it('writes only the ciphertext envelope at rest (no plaintext PHI)', async () => {
    const engine = makeEngine();
    await engine.create(makeInput({ drugName: 'Hydrocortisone' }));

    const raw = backend.snapshot()['cpv:partition:medications'];
    expect(raw).toBeDefined();
    expect(raw).not.toContain('Hydrocortisone');
    expect(raw).not.toContain('drugName');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(
      ['auth_tag', 'ciphertext', 'iv', 'sync_version'].sort(),
    );
  });

  it('stores a valid PRN schedule with safety limit (11.5, 13.3)', async () => {
    const engine = makeEngine();
    const prn: PrnConfig = { doseAmount: 1, doseUnit: 'tablet', safetyLimit24h: 4 };
    const result = await engine.create(
      makeInput({ schedule: { kind: 'prn' }, prn }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.regimens[0]?.prn).toEqual(prn);
  });

  it('appends multiple profiles without losing earlier records', async () => {
    const engine = makeEngine();
    await engine.create(makeInput({ drugName: 'Aspirin' }));
    await engine.create(makeInput({ drugName: 'Ibuprofen' }));
    const stored = await engine.list();
    expect(stored.map((r) => r.drugName).sort()).toEqual(['Aspirin', 'Ibuprofen']);
  });
});

describe('MedicationProfileEngine.create — invalid profiles (10.2)', () => {
  it('rejects an empty required field per-field and stores nothing', async () => {
    const engine = makeEngine();
    const result = await engine.create(makeInput({ drugName: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_PROFILE');
    if (result.error !== 'INVALID_PROFILE') return;
    expect(result.fieldErrors.map((e) => e.field)).toContain('drugName');

    // Nothing persisted.
    expect(Object.keys(backend.snapshot())).toHaveLength(0);
    expect(await engine.list()).toHaveLength(0);
  });

  it('reports every invalid field at once', async () => {
    const engine = makeEngine();
    const tooLong = 'x'.repeat(201);
    const result = await engine.create(makeInput({ drugName: '', dosage: tooLong, form: '' }));
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== 'INVALID_PROFILE') return;
    const fields = result.fieldErrors.map((e) => e.field).sort();
    expect(fields).toEqual(['dosage', 'drugName', 'form']);
  });

  it('rejects an invalid schedule (rotating interval out of range) and stores nothing', async () => {
    const engine = makeEngine();
    const result = await engine.create(
      makeInput({ schedule: { kind: 'rotating-interval', everyNDays: 366, times: ['08:00'] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_SCHEDULE');
    expect(Object.keys(backend.snapshot())).toHaveLength(0);
  });

  it('rejects an out-of-range PRN safety limit and stores nothing (13.4)', async () => {
    const engine = makeEngine();
    const result = await engine.create(
      makeInput({
        schedule: { kind: 'prn' },
        prn: { doseAmount: 1, doseUnit: 'tablet', safetyLimit24h: 0 },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_PRN_LIMIT');
    expect(Object.keys(backend.snapshot())).toHaveLength(0);
  });
});

describe('MedicationProfileEngine.update — editing existing profiles (10.4, 10.5)', () => {
  it('updates the corresponding record in the Local_Vault', async () => {
    const engine = makeEngine();
    const created = await engine.create(makeInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updatedRegimens = created.profile.regimens.map((regimen) => ({
      ...regimen,
      dosage: '20mg',
    }));
    const result = await engine.update(created.profile.id, { regimens: updatedRegimens });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.regimens[0]?.dosage).toBe('20mg');
    // Other fields retained.
    expect(result.profile.drugName).toBe('Methotrexate');

    const reread = await engine.get(created.profile.id);
    expect(reread?.regimens[0]?.dosage).toBe('20mg');
  });

  it('records a new op_timestamp on update (10.5)', async () => {
    const clock = controllableClock();
    clock.set('2026-01-01T00:00:00.000Z');
    const engine = makeEngine({ now: clock.now });

    const created = await engine.create(makeInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.profile.op_timestamp).toBe('2026-01-01T00:00:00.000Z');

    clock.set('2026-02-02T12:00:00.000Z');
    const updatedRegimens = created.profile.regimens.map((regimen) => ({
      ...regimen,
      dosage: '25mg',
    }));
    const updated = await engine.update(created.profile.id, { regimens: updatedRegimens });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.profile.op_timestamp).toBe('2026-02-02T12:00:00.000Z');
    expect(updated.profile.op_timestamp).not.toBe(created.profile.op_timestamp);
  });

  it('rejects an edit that makes a field invalid and leaves the stored record unchanged', async () => {
    const engine = makeEngine();
    const created = await engine.create(makeInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await engine.update(created.profile.id, { drugName: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_PROFILE');

    const reread = await engine.get(created.profile.id);
    expect(reread?.drugName).toBe('Methotrexate');
  });
});

describe('MedicationProfileEngine.update — non-existent profiles (10.6)', () => {
  it('rejects an edit to a profile that does not exist and leaves records unchanged', async () => {
    const engine = makeEngine();
    await engine.create(makeInput({ drugName: 'Aspirin' }));

    const before = await engine.list();
    const updatedRegimens = before[0]!.regimens.map((regimen) => ({
      ...regimen,
      dosage: '99mg',
    }));
    const result = await engine.update('does-not-exist', { regimens: updatedRegimens });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');

    const after = await engine.list();
    expect(after).toEqual(before);
  });

  it('rejects an edit against an empty partition with NOT_FOUND and writes nothing', async () => {
    const engine = makeEngine();
    const result = await engine.update('med-1', {
      regimens: [
        {
          id: 'reg-1',
          dosage: '5mg',
          form: 'tablet',
          schedule: weeklySchedule,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');
    expect(Object.keys(backend.snapshot())).toHaveLength(0);
  });
});
