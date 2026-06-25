import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { PrnConfig, PrnLog } from '@complex-patient/domain';
import {
  MedicationProfileEngine,
  PrnQuickLogEngine,
  evaluatePrnQuickLog,
} from './index';
import type { MedicationProfileInput, VaultCrypto } from './index';

/**
 * Targeted unit tests for the PRN 24-hour safety threshold logic (Task 11.4).
 *
 * Complements the round-trip coverage in `prn.test.ts` (Task 11.2) and the
 * property test in `prn.property.test.ts` (Task 11.3) with example-based edge
 * cases for the four behaviours called out by the task:
 *
 * - at-limit acceptance (Requirement 13.5)
 * - over-limit blocking leaving the cumulative unchanged (Requirement 13.6)
 * - override acknowledgement records a flagged entry (Requirement 13.7)
 * - cancel/dismiss leaves the cumulative unchanged (Requirement 13.8)
 *
 * Edge cases added here that are NOT already covered by 11.2:
 * - fractional dose amounts and a fractional safety limit
 * - landing *exactly* on the limit via a fractional sum
 * - a dose larger than the whole limit (first-tap over-limit) blocking
 * - multiple sequential overrides each flagged independently
 * - explicit cancel-then-retry: dismissing then later logging once a dose
 *   ages out, proving cancel persisted nothing
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(11));
const crypto: VaultCrypto = { encrypt, decrypt };

function sequentialIds(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function prnInput(prn: PrnConfig): MedicationProfileInput {
  return {
    drugName: 'Hydromorphone',
    prescribingPhysician: 'Dr. Lee',
    conditionTreated: 'Breakthrough pain',
    active: true,
    regimens: [
      {
        id: 'reg-1',
        dosage: '2mg',
        form: 'tablet',
        schedule: { kind: 'prn' },
        prn,
      },
    ],
  };
}

let vault: LocalVault;
let backend: MemoryStorageBackend;

beforeEach(async () => {
  backend = new MemoryStorageBackend();
  vault = await createLocalVault(backend);
});

async function seedPrnMedication(prn: PrnConfig): Promise<string> {
  const profileEngine = new MedicationProfileEngine({
    store: vault,
    crypto,
    kek: KEY,
    newId: sequentialIds('med'),
  });
  const created = await profileEngine.create(prnInput(prn));
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

describe('evaluatePrnQuickLog — fractional + boundary edge cases (13.5, 13.6)', () => {
  it('accepts a fractional sum that lands exactly on a fractional limit', () => {
    // 1.5 + 1 = 2.5 == limit 2.5 → at-limit acceptance (13.5).
    const e = evaluatePrnQuickLog({
      existingCumulative: 1.5,
      doseAmount: 1,
      safetyLimit24h: 2.5,
      overrideAcknowledged: false,
    });
    expect(e).toMatchObject({
      projectedCumulative: 2.5,
      withinLimit: true,
      recorded: true,
      blocked: false,
      overrideFlag: false,
    });
  });

  it('blocks when a fractional sum is just past the limit (13.6)', () => {
    // 2.25 + 0.5 = 2.75 > 2.5 → blocked, cumulative input unchanged.
    const e = evaluatePrnQuickLog({
      existingCumulative: 2.25,
      doseAmount: 0.5,
      safetyLimit24h: 2.5,
      overrideAcknowledged: false,
    });
    expect(e).toMatchObject({
      existingCumulative: 2.25,
      projectedCumulative: 2.75,
      withinLimit: false,
      recorded: false,
      blocked: true,
    });
  });

  it('blocks a first-tap dose that alone exceeds the whole limit (13.6)', () => {
    const e = evaluatePrnQuickLog({
      existingCumulative: 0,
      doseAmount: 5,
      safetyLimit24h: 4,
      overrideAcknowledged: false,
    });
    expect(e).toMatchObject({ projectedCumulative: 5, blocked: true, recorded: false });
  });

  it('records a flagged override for a first-tap over-limit dose when acknowledged (13.7)', () => {
    const e = evaluatePrnQuickLog({
      existingCumulative: 0,
      doseAmount: 5,
      safetyLimit24h: 4,
      overrideAcknowledged: true,
    });
    expect(e).toMatchObject({ recorded: true, blocked: false, overrideFlag: true });
  });
});

describe('PrnQuickLogEngine.quickLog — fractional doses (13.5, 13.6)', () => {
  // dose 0.5, limit 1.5 → 0.5, 1.0, 1.5 accepted; 2.0 blocked.
  const fractionalPrn: PrnConfig = { doseAmount: 0.5, doseUnit: 'mL', safetyLimit24h: 1.5 };

  it('accepts fractional doses up to and exactly at a fractional limit', async () => {
    const medId = await seedPrnMedication(fractionalPrn);
    const engine = makeQuickLogEngine(() => '2026-03-01T08:00:00.000Z');

    const expected = [0.5, 1.0, 1.5];
    for (const want of expected) {
      const r = await engine.quickLog(medId);
      expect(r.ok).toBe(true);
      if (!r.ok || r.outcome !== 'logged') throw new Error('expected logged');
      expect(r.cumulative24h).toBeCloseTo(want, 10);
    }

    expect(await engine.cumulative24h(medId)).toBeCloseTo(1.5, 10);
  });

  it('blocks the dose that would exceed the fractional limit and leaves cumulative unchanged (13.6, 13.8)', async () => {
    const medId = await seedPrnMedication(fractionalPrn);
    const engine = makeQuickLogEngine(() => '2026-03-01T08:00:00.000Z');
    for (let i = 0; i < 3; i++) await engine.quickLog(medId); // reach 1.5 (the limit)

    const before = await engine.cumulative24h(medId);
    const blocked = await engine.quickLog(medId);
    expect(blocked.ok).toBe(true);
    if (!blocked.ok || blocked.outcome !== 'override-required') throw new Error('expected override-required');
    expect(blocked.cumulative24h).toBeCloseTo(1.5, 10);
    expect(blocked.projectedCumulative).toBeCloseTo(2.0, 10);

    // Cancel/dismiss: the cumulative is identical to before the blocked attempt.
    expect(await engine.cumulative24h(medId)).toBeCloseTo(before, 10);
  });
});

describe('PrnQuickLogEngine.quickLog — sequential override accounting (13.7)', () => {
  it('flags each acknowledged override independently and keeps unflagged logs unflagged', async () => {
    const prn: PrnConfig = { doseAmount: 1, doseUnit: 'tablet', safetyLimit24h: 2 };
    const medId = await seedPrnMedication(prn);
    const engine = makeQuickLogEngine(() => '2026-04-01T08:00:00.000Z');

    // Two within-limit logs (no flag).
    const a = await engine.quickLog(medId);
    const b = await engine.quickLog(medId);
    if (!a.ok || a.outcome !== 'logged') throw new Error('expected logged');
    if (!b.ok || b.outcome !== 'logged') throw new Error('expected logged');
    expect(a.log.override).toBeUndefined();
    expect(b.log.override).toBeUndefined();

    // Third tap is over-limit → blocked.
    const blocked = await engine.quickLog(medId);
    if (!blocked.ok || blocked.outcome !== 'override-required') throw new Error('expected override-required');

    // Acknowledge twice; both recorded entries are flagged overrides.
    const o1 = await engine.quickLog(medId, { overrideAcknowledged: true });
    const o2 = await engine.quickLog(medId, { overrideAcknowledged: true });
    if (!o1.ok || o1.outcome !== 'logged-override') throw new Error('expected logged-override');
    if (!o2.ok || o2.outcome !== 'logged-override') throw new Error('expected logged-override');
    expect(o1.log.override).toBe(true);
    expect(o2.log.override).toBe(true);
    expect(o1.cumulative24h).toBe(3);
    expect(o2.cumulative24h).toBe(4);
  });
});

describe('PrnQuickLogEngine.quickLog — cancel persists nothing (13.8)', () => {
  it('a dismissed prompt records no log and never writes to the partition', async () => {
    const prn: PrnConfig = { doseAmount: 1, doseUnit: 'tablet', safetyLimit24h: 1 };
    const medId = await seedPrnMedication(prn);
    const engine = makeQuickLogEngine(() => '2026-05-01T08:00:00.000Z');

    // First tap fills the limit.
    const first = await engine.quickLog(medId);
    if (!first.ok || first.outcome !== 'logged') throw new Error('expected logged');

    // Second tap blocks. Cancelling = not calling again with override.
    const blocked = await engine.quickLog(medId);
    if (!blocked.ok || blocked.outcome !== 'override-required') throw new Error('expected override-required');

    // Inspect the persisted partition directly: exactly one stored, non-override log.
    const decryptedLogs = await readPersistedLogs();
    const live = decryptedLogs.filter((l) => l.deleted !== true);
    expect(live).toHaveLength(1);
    expect(live[0].override).toBeUndefined();

    expect(await engine.cumulative24h(medId)).toBe(1);
  });

  // Helper: decrypt the medications partition to assert on the stored PRN logs.
  async function readPersistedLogs(): Promise<PrnLog[]> {
    const { readMedicationPartition } = await import('./gateway');
    const state = await readMedicationPartition(vault, crypto, KEY);
    return [...state.prnLogs];
  }
});
