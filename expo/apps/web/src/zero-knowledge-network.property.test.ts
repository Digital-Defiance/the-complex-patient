/**
 * Property-based test for the Zero-Knowledge Network invariant.
 *
 * Feature: complex-patient-platform, Property 12: Zero-knowledge network
 * invariant — for any sequence of sync and analytics operations over any
 * generated PHI, no outbound network request body, header, or query parameter
 * contains plaintext PHI or derived analytics values; only
 * `{ sync_version, iv, auth_tag, ciphertext }` envelopes cross the boundary.
 *
 * This exercises the REAL end-to-end client stack — the shared authenticated
 * home (`@complex-patient/ui`) composing the vault store, offline-sync
 * coordinator, Sync_Worker, and the authenticated blind vault HTTP client —
 * over the encrypted Local_Vault with REAL AES-256-GCM encryption
 * (`@complex-patient/crypto-engine`). A {@link createNetworkSpy} wraps the
 * injectable `FetchLike` transport (the single network seam, conceptually
 * `window.fetch` / `XMLHttpRequest` on web) and captures every outbound
 * request's method, URL, query string, headers, and body. The on-device
 * analytics (`@complex-patient/insights`) are run over the same PHI to prove
 * they emit no network traffic at all.
 *
 * **Validates: Requirements 4.6, 4.8, 19.1, 19.2**
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { createLocalVault, MemoryStorageBackend } from '@complex-patient/local-vault';
import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type {
  MedicationProfile,
  PrnLog,
  SymptomEntry,
  VaultRecord,
  VaultType,
} from '@complex-patient/domain';
import {
  buildPhysicianReport,
  createInMemoryReportDataSource,
  detectCorrelations,
  generatePhysicianReport,
  runAnalysis,
  type MedEvent,
  type PhysicianReport,
  type PhysicianReportRenderer,
} from '@complex-patient/insights';
import { createWebHome } from './entry';
import { createNetworkSpy, type CapturedRequest } from './network-spy';

// The only fields permitted to cross the zero-knowledge boundary (4.6, 4.8).
const ENVELOPE_KEYS = ['auth_tag', 'ciphertext', 'iv', 'sync_version'].sort();

// A fixed, non-PHI session KEK (32 bytes) for hydrating the vault store.
const KEK: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(7));

// A non-PHI WordPress credential. The token is the ONLY thing that legitimately
// authenticates the request; it must never be confused with PHI.
const JWT_TOKEN = 'session-jwt-not-phi';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// PHI generators
//
// Every generated PHI string is prefixed with a label and an underscore. The
// underscore is NOT a Base64 character, so a labelled token can never appear as
// a coincidental substring of a legitimate Base64 ciphertext/iv/auth_tag — yet
// it WOULD appear verbatim if the code ever leaked the plaintext value into a
// request body, header, or query string. This makes leak detection both
// sound (no false negatives for real plaintext leaks) and free of false
// positives against the encrypted envelope.
// ---------------------------------------------------------------------------

/** A distinctive PHI string token: `<LABEL>_<random A-Z0-9>`. */
function phiString(label: string): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
      minLength: 6,
      maxLength: 14,
    })
    .map((chars) => `${label}_${chars.join('')}`);
}

/** An ISO timestamp within the trailing ~25 days, so analytics has live data. */
const recentIso: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 25 * MS_PER_DAY })
  .map((ageMs) => new Date(Date.now() - ageMs).toISOString());

const timeUnit = fc.constantFrom('minutes', 'hours', 'days', 'weeks') as fc.Arbitrary<
  'minutes' | 'hours' | 'days' | 'weeks'
>;

const medicationArb: fc.Arbitrary<MedicationProfile> = fc.record({
  id: phiString('MEDID'),
  op_timestamp: recentIso,
  drugName: phiString('DRUG'),
  dosage: phiString('DOSE'),
  form: phiString('FORM'),
  prescribingPhysician: phiString('DOC'),
  conditionTreated: phiString('COND'),
  active: fc.boolean(),
  schedule: fc.constant({ kind: 'prn' as const }),
});

const symptomArb: fc.Arbitrary<SymptomEntry> = fc.record({
  id: phiString('SYMID'),
  op_timestamp: recentIso,
  symptomType: phiString('SYMP'),
  systemicLocation: phiString('LOC'),
  severity: fc.integer({ min: 1, max: 10 }),
  duration: fc.record({ value: fc.integer({ min: 1, max: 100 }), unit: timeUnit }),
  notes: phiString('NOTE'),
  active: fc.boolean(),
});

const prnLogArb: fc.Arbitrary<PrnLog> = fc.record({
  id: phiString('PRNID'),
  op_timestamp: recentIso,
  medicationId: phiString('MEDID'),
  amount: fc.integer({ min: 1, max: 50 }),
  takenAt: recentIso,
});

const medEventArb: fc.Arbitrary<MedEvent> = fc.record({
  id: phiString('EVTID'),
  op_timestamp: recentIso,
  medicationId: phiString('MEDID'),
  scheduledAt: recentIso,
  takenAt: fc.oneof(recentIso, fc.constant(null)),
});

interface ConditionRec extends VaultRecord {
  name: string;
}
const conditionArb: fc.Arbitrary<ConditionRec> = fc.record({
  id: phiString('CONDID'),
  op_timestamp: recentIso,
  name: phiString('DIAG'),
});

interface FlareRec extends VaultRecord {
  symptomIds: string[];
  trigger: string;
}
const flareArb: fc.Arbitrary<FlareRec> = fc.record({
  id: phiString('FLAREID'),
  op_timestamp: recentIso,
  symptomIds: fc.array(phiString('SYMID'), { minLength: 0, maxLength: 3 }),
  trigger: phiString('TRIG'),
});

interface AssociationRec extends VaultRecord {
  symptomId: string;
  conditionIds: string[];
  medicationIds: string[];
}
const associationArb: fc.Arbitrary<AssociationRec> = fc.record({
  id: phiString('ASSOCID'),
  op_timestamp: recentIso,
  symptomId: phiString('SYMID'),
  conditionIds: fc.array(phiString('CONDID'), { minLength: 0, maxLength: 3 }),
  medicationIds: fc.array(phiString('MEDID'), { minLength: 0, maxLength: 3 }),
});

/** The full generated PHI dataset driven through sync + analytics. */
interface GeneratedPhi {
  medications: MedicationProfile[];
  symptoms: SymptomEntry[];
  conditions: ConditionRec[];
  flares: FlareRec[];
  associations: AssociationRec[];
  prnLogs: PrnLog[];
  medEvents: MedEvent[];
}

const phiArb: fc.Arbitrary<GeneratedPhi> = fc.record({
  medications: fc.array(medicationArb, { minLength: 0, maxLength: 5 }),
  symptoms: fc.array(symptomArb, { minLength: 0, maxLength: 5 }),
  conditions: fc.array(conditionArb, { minLength: 0, maxLength: 3 }),
  flares: fc.array(flareArb, { minLength: 0, maxLength: 3 }),
  associations: fc.array(associationArb, { minLength: 0, maxLength: 3 }),
  prnLogs: fc.array(prnLogArb, { minLength: 0, maxLength: 5 }),
  medEvents: fc.array(medEventArb, { minLength: 0, maxLength: 5 }),
});

/** The five PHI partitions written through the vault store, in commit order. */
const PARTITIONS: VaultType[] = [
  'medications',
  'symptoms',
  'conditions',
  'flares',
  'associations',
  'locationTrail',
];

/**
 * Collect EVERY plaintext PHI string token present anywhere in the dataset, so
 * the test can assert none of them appears in any outbound request.
 */
function collectPhiTokens(phi: GeneratedPhi): Set<string> {
  const tokens = new Set<string>();
  const add = (...vals: Array<string | undefined>) => {
    for (const v of vals) {
      if (typeof v === 'string' && v.length > 0) tokens.add(v);
    }
  };
  for (const m of phi.medications) {
    add(m.id, m.drugName, m.dosage, m.form, m.prescribingPhysician, m.conditionTreated);
  }
  for (const s of phi.symptoms) {
    add(s.id, s.symptomType, s.systemicLocation, s.notes);
  }
  for (const c of phi.conditions) add(c.id, c.name);
  for (const f of phi.flares) {
    add(f.id, f.trigger, ...f.symptomIds);
  }
  for (const a of phi.associations) {
    add(a.id, a.symptomId, ...a.conditionIds, ...a.medicationIds);
  }
  for (const p of phi.prnLogs) add(p.id, p.medicationId);
  for (const e of phi.medEvents) add(e.id, e.medicationId);
  return tokens;
}

/** Map a generated PHI partition to the records committed for a vault type. */
function recordsFor(phi: GeneratedPhi, vaultType: VaultType): VaultRecord[] {
  switch (vaultType) {
    case 'medications':
      return phi.medications;
    case 'symptoms':
      return phi.symptoms;
    case 'conditions':
      return phi.conditions;
    case 'flares':
      return phi.flares;
    case 'associations':
      return phi.associations;
    default:
      return [];
  }
}

/** Wait until the spy has captured at least `n` requests (background sync settles). */
async function waitForRequests(requests: CapturedRequest[], n: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (requests.length < n && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A trivial on-device PDF renderer — produces bytes, performs no I/O. */
const noopRenderer: PhysicianReportRenderer<Uint8Array> = {
  render: (_report: PhysicianReport) => new Uint8Array([1, 2, 3]),
};

describe('Property 12: Zero-knowledge network invariant', () => {
  /**
   * **Validates: Requirements 4.6, 4.8, 19.1, 19.2**
   *
   * For any generated PHI:
   *  - every committed partition is synced through the real client stack, and
   *    every outbound request body contains EXACTLY the blind envelope
   *    `{ sync_version, iv, auth_tag, ciphertext }` (4.6, 4.8);
   *  - no request body, header, or query string contains any plaintext PHI
   *    token (4.6, 4.8);
   *  - running the on-device analytics + report over the same PHI emits ZERO
   *    additional network traffic, so no raw or derived analytics value can
   *    reach a network-bound buffer (19.1, 19.2).
   */
  it.prop([phiArb], { numRuns: 50 })(
    'no plaintext PHI or derived analytics value crosses the network; only blind envelopes do',
    async (phi) => {
      const spy = createNetworkSpy();
      const vault = await createLocalVault(new MemoryStorageBackend());
      const controller = await createWebHome({
        baseUrl: 'https://patient.example.com',
        fetch: spy.fetch,
        vault,
        assumeSecureContext: true,
      });

      try {
        // Authenticate + unlock the vault so the store hydrates and commits run.
        controller.signIn({ kind: 'jwt', token: JWT_TOKEN });
        const unlock = await controller.unlockWithKek(KEK);
        expect(unlock).toEqual({ ok: true, status: 'ready' });

        // --- Sync: commit each PHI partition (local-first write-through, then
        //     background push through the blind vault HTTP client). ---
        for (const vaultType of PARTITIONS) {
          const records = recordsFor(phi, vaultType);
          const result = await controller.commit<VaultRecord>(vaultType, () => records);
          expect(result.ok).toBe(true);
        }

        // Let the fire-and-forget background sync passes settle: one POST per
        // committed partition.
        await waitForRequests(spy.requests, PARTITIONS.length);
        const syncRequestCount = spy.requests.length;
        expect(syncRequestCount).toBeGreaterThanOrEqual(PARTITIONS.length);

        // --- Analytics: run the sandboxed on-device pipeline + report over the
        //     SAME decrypted PHI. None of this may touch the network (19.1, 19.2). ---
        const dataSource = createInMemoryReportDataSource({
          medications: phi.medications,
          symptoms: phi.symptoms,
          prnLogs: phi.prnLogs,
          medEvents: phi.medEvents,
        });
        runAnalysis(dataSource);
        detectCorrelations(dataSource);
        buildPhysicianReport(dataSource);
        generatePhysicianReport(dataSource, noopRenderer);

        // Give any (erroneous) analytics-triggered async request a chance to land.
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Analytics emitted NO additional network traffic (19.1, 19.2).
        expect(spy.requests.length).toBe(syncRequestCount);

        // --- Assert the invariant over EVERY captured request. ---
        const phiTokens = collectPhiTokens(phi);
        for (const request of spy.requests) {
          // 1) Body carries ONLY the blind envelope fields (4.6, 4.8).
          expect(typeof request.body).toBe('string');
          const parsed = JSON.parse(request.body as string) as Record<string, unknown>;
          expect(Object.keys(parsed).sort()).toEqual(ENVELOPE_KEYS);
          expect(typeof parsed.sync_version).toBe('number');
          expect(typeof parsed.iv).toBe('string');
          expect(typeof parsed.auth_tag).toBe('string');
          expect(typeof parsed.ciphertext).toBe('string');

          // 2) Headers expose only the auth credential + content type — no PHI.
          expect(Object.keys(request.headers).sort()).toEqual(
            ['Authorization', 'Content-Type'].sort(),
          );

          // 3) No plaintext PHI token appears in the method, URL, query string,
          //    headers, or body of the request (4.6, 4.8, 19.1, 19.2).
          const serialized = spy.serialize(request);
          for (const token of phiTokens) {
            expect(serialized.includes(token)).toBe(false);
          }
          // The query string carries no parameters at all.
          expect(request.search).toBe('');
        }
      } finally {
        controller.dispose();
      }
    },
  );
});
