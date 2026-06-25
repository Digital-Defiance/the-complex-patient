import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { MedicationProfile, PrnConfig, PrnLog } from '@complex-patient/domain';
import {
  MedicationProfileEngine,
  PrnQuickLogEngine,
  computeTrailing24hCumulative,
  evaluatePrnQuickLog,
} from './index';
import type { MedicationProfileInput, VaultCrypto } from './index';

/**
 * Unit tests for PRN Quick Log + the 24-hour safety threshold (Task 11.2).
 *
 * Exercises the real Crypto_Engine + EncryptedLocalVault (no mocks) so the
 * encrypt → persist → decrypt round-trip is validated alongside the safety
 * logic. Covers:
 * - one-tap Quick Log records the configured dose (13.1, 13.5)
 * - at-limit acceptance (13.5)
 * - over-limit blocking leaves cumulative unchanged (13.6)
 * - override acknowledgement records flagged entry (13.7)
 * - cancel/dismiss leaves cumulative unchanged (13.8)
 * - trailing-24h window excludes logs older than 24h
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(7));
const crypto: VaultCrypto = { encrypt, decrypt };

function sequentialIds(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const prnConfig: PrnConfig = { doseAmount: 1, doseUnit: 'tablet', safetyLimit24h: 4 };

function prnInput(overrides: Partial<MedicationProfileInput> & { dosage?: string; form?: string; prn?: PrnConfig } = {}): MedicationProfileInput {
  const { dosage = '5mg', form = 'tablet', prn = prnConfig, regimens, ...rest } = overrides;
  return {
    drugName: 'Oxycodone',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'Pain',
    active: true,
    regimens:
      regimens ??
      [
        {
          id: 'reg-1',
          dosage,
          form,
          schedule: { kind: 'prn' },
          prn,
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

/** Create a PRN medication profile and return its id. */
async function seedPrnMedication(prn: PrnConfig = prnConfig): Promise<string> {
  const profileEngine = new MedicationProfileEngine({
    store: vault,
    crypto,
    kek: KEY,
    newId: sequentialIds('med'),
  });
  const created = await profileEngine.create(prnInput({ prn }));
  if (!created.ok) throw new Error('failed to seed PRN medication');
  return created.profile.id;
}

function makeQuickLogEngine(now: () => string) {
  return new PrnQuickLogEngine({
    store: vault,
    crypto,
    kek: KEY,
    newId: sequentialIds('log'),
    now,
  });
}

describe('computeTrailing24hCumulative — trailing window (13.5, 13.6)', () => {
  const nowMs = Date.parse('2026-01-02T00:00:00.000Z');
  const logs: PrnLog[] = [
    { id: 'a', op_timestamp: '', medicationId: 'm1', amount: 2, takenAt: '2026-01-01T01:00:00.000Z' }, // 23h ago — in window
    { id: 'b', op_timestamp: '', medicationId: 'm1', amount: 3, takenAt: '2026-01-01T23:59:00.000Z' }, // in window
    { id: 'c', op_timestamp: '', medicationId: 'm1', amount: 5, takenAt: '2025-12-31T23:00:00.000Z' }, // >24h ago — excluded
    { id: 'd', op_timestamp: '', medicationId: 'm2', amount: 9, takenAt: '2026-01-01T12:00:00.000Z' }, // other med — excluded
  ];

  it('sums only this medication within the last 24h', () => {
    expect(computeTrailing24hCumulative(logs, 'm1', nowMs)).toBe(5);
  });

  it('excludes soft-deleted logs', () => {
    const withDeleted: PrnLog[] = [
      ...logs,
      { id: 'e', op_timestamp: '', medicationId: 'm1', amount: 10, takenAt: '2026-01-01T12:00:00.000Z', deleted: true },
    ];
    expect(computeTrailing24hCumulative(withDeleted, 'm1', nowMs)).toBe(5);
  });

  it('excludes logs exactly past the 24h boundary but includes the boundary itself', () => {
    const boundary = nowMs - 24 * 60 * 60 * 1000;
    const at: PrnLog[] = [
      { id: 'x', op_timestamp: '', medicationId: 'm1', amount: 1, takenAt: new Date(boundary).toISOString() },
      { id: 'y', op_timestamp: '', medicationId: 'm1', amount: 1, takenAt: new Date(boundary - 1).toISOString() },
    ];
    expect(computeTrailing24hCumulative(at, 'm1', nowMs)).toBe(1);
  });
});

describe('evaluatePrnQuickLog — pure decision (13.5, 13.6, 13.7)', () => {
  it('records when projected is below the limit', () => {
    const e = evaluatePrnQuickLog({ existingCumulative: 1, doseAmount: 1, safetyLimit24h: 4, overrideAcknowledged: false });
    expect(e).toMatchObject({ recorded: true, blocked: false, overrideFlag: false, projectedCumulative: 2 });
  });

  it('records at exactly the limit (at-or-below)', () => {
    const e = evaluatePrnQuickLog({ existingCumulative: 3, doseAmount: 1, safetyLimit24h: 4, overrideAcknowledged: false });
    expect(e).toMatchObject({ recorded: true, blocked: false, withinLimit: true, overrideFlag: false });
  });

  it('blocks when projected strictly exceeds the limit and no override', () => {
    const e = evaluatePrnQuickLog({ existingCumulative: 4, doseAmount: 1, safetyLimit24h: 4, overrideAcknowledged: false });
    expect(e).toMatchObject({ recorded: false, blocked: true, withinLimit: false });
  });

  it('records flagged override when over limit and acknowledged', () => {
    const e = evaluatePrnQuickLog({ existingCumulative: 4, doseAmount: 1, safetyLimit24h: 4, overrideAcknowledged: true });
    expect(e).toMatchObject({ recorded: true, blocked: false, overrideFlag: true });
  });
});

describe('PrnQuickLogEngine.quickLog — one-tap recording (13.1, 13.5)', () => {
  it('records the configured PRN dose on a one-tap log', async () => {
    const medId = await seedPrnMedication();
    const engine = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');

    const result = await engine.quickLog(medId);
    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'logged') throw new Error('expected logged');
    expect(result.log.amount).toBe(prnConfig.doseAmount);
    expect(result.log.medicationId).toBe(medId);
    expect(result.log.override).toBeUndefined();
    expect(result.cumulative24h).toBe(1);
  });

  it('rejects Quick Log for an unknown medication', async () => {
    const engine = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');
    const result = await engine.quickLog('does-not-exist');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');
  });

  it('rejects Quick Log for a non-PRN medication', async () => {
    const profileEngine = new MedicationProfileEngine({ store: vault, crypto, kek: KEY, newId: sequentialIds('med') });
    const created = await profileEngine.create({
      drugName: 'Lisinopril',
      prescribingPhysician: 'Dr. Who',
      conditionTreated: 'BP',
      active: true,
      regimens: [
        {
          id: 'reg-1',
          dosage: '10mg',
          form: 'tablet',
          schedule: { kind: 'weekly', daysOfWeek: ['MON'], times: ['08:00'] },
        },
      ],
    });
    if (!created.ok) throw new Error('seed failed');
    const engine = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');
    const result = await engine.quickLog(created.profile.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_PRN');
  });
});

describe('PrnQuickLogEngine.quickLog — 24h safety threshold (13.5, 13.6, 13.7, 13.8)', () => {
  it('accepts logs up to and at the limit', async () => {
    const medId = await seedPrnMedication(); // limit 4, dose 1
    const engine = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');

    for (let i = 1; i <= 4; i++) {
      const r = await engine.quickLog(medId);
      expect(r.ok).toBe(true);
      if (!r.ok || r.outcome !== 'logged') throw new Error('expected logged');
      expect(r.cumulative24h).toBe(i);
    }
  });

  it('blocks the 5th over-limit log and leaves the cumulative unchanged (13.6, 13.8)', async () => {
    const medId = await seedPrnMedication();
    const engine = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');
    for (let i = 0; i < 4; i++) await engine.quickLog(medId);

    const before = await engine.cumulative24h(medId);
    expect(before).toBe(4);

    const blocked = await engine.quickLog(medId);
    expect(blocked.ok).toBe(true);
    if (!blocked.ok || blocked.outcome !== 'override-required') throw new Error('expected override-required');
    expect(blocked.cumulative24h).toBe(4);
    expect(blocked.projectedCumulative).toBe(5);
    expect(blocked.safetyLimit24h).toBe(4);

    // Cancel/dismiss: not calling again leaves cumulative unchanged (13.8).
    const after = await engine.cumulative24h(medId);
    expect(after).toBe(4);
  });

  it('records a flagged override when the user confirms the prompt (13.7)', async () => {
    const medId = await seedPrnMedication();
    const engine = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');
    for (let i = 0; i < 4; i++) await engine.quickLog(medId);

    const override = await engine.quickLog(medId, { overrideAcknowledged: true });
    expect(override.ok).toBe(true);
    if (!override.ok || override.outcome !== 'logged-override') throw new Error('expected logged-override');
    expect(override.log.override).toBe(true);
    expect(override.cumulative24h).toBe(5);

    expect(await engine.cumulative24h(medId)).toBe(5);
  });

  it('lets the cumulative recover as old logs roll out of the 24h window', async () => {
    const medId = await seedPrnMedication();
    // 4 logs at day 1 fill the limit.
    const day1 = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');
    for (let i = 0; i < 4; i++) await day1.quickLog(medId);

    // 25h later the day-1 logs have aged out; a new log is accepted.
    const day2 = makeQuickLogEngine(() => '2026-01-02T09:00:00.000Z');
    const r = await day2.quickLog(medId);
    expect(r.ok).toBe(true);
    if (!r.ok || r.outcome !== 'logged') throw new Error('expected logged');
    expect(r.cumulative24h).toBe(1);
  });
});

describe('PrnQuickLogEngine — persistence is additive with profiles', () => {
  it('preserves medication profiles when logging and persists logs encrypted', async () => {
    const medId = await seedPrnMedication();
    const engine = makeQuickLogEngine(() => '2026-01-01T08:00:00.000Z');
    await engine.quickLog(medId);

    // Profile still present after logging.
    const profileEngine = new MedicationProfileEngine({ store: vault, crypto, kek: KEY });
    const profiles = await profileEngine.list();
    expect(profiles.map((p: MedicationProfile) => p.id)).toContain(medId);

    // Ciphertext only at rest.
    const raw = backend.snapshot()['cpv:partition:medications'];
    expect(raw).not.toContain('Oxycodone');
    expect(raw).not.toContain('medicationId');
  });
});
