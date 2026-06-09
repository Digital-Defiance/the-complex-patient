import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type {
  BiometricAdapter,
  KekCodec,
  SecureStoreAdapter,
} from '@complex-patient/key-store';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import { createMobileHome, createMobileApp } from './entry';

/**
 * Universal end-to-end integration tests — NATIVE runtime (task 15.4).
 *
 * These wire the SAME shared authenticated-home controller through the native
 * composition root {@link createMobileHome} with mocked Secure Enclave +
 * biometric adapters, the REAL Crypto_Engine (AES-256-GCM), and the REAL
 * EncryptedLocalVault, then exercise the three universal flows the design calls
 * out:
 *
 *   1. unlock → decrypt → render  (Requirements 5.2, 5.4)
 *   2. local write → enqueue → sync  (Requirements 5.2, 5.4)
 *   3. lock-clears-store  (Requirements 3.6, 3.7)
 *
 * A sibling suite in `apps/web/src/universal-e2e.integration.test.ts` runs the
 * IDENTICAL flows through `createWebHome`, proving feature parity across native
 * and web from one shared codebase (Requirement 22.2) over the centralized,
 * shared Crypto_Engine (Requirement 22.3).
 */

const utf8 = new TextEncoder();

/** The session KEK the mocked Secure Enclave codec resolves to. */
const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(11));

interface MedRec extends VaultRecord {
  drugName: string;
}

const codec: KekCodec = {
  serialize: () => 'serialized-kek',
  deserialize: () => KEY,
};

const biometrics: BiometricAdapter = {
  isAvailable: async () => true,
  authenticate: async () => true,
};

function makeSecureStore(initial: string | null = null): SecureStoreAdapter {
  let stored = initial;
  return {
    setKek: async (s) => {
      stored = s;
    },
    getKek: async () => stored,
    deleteKek: async () => {
      stored = null;
    },
  };
}

/** A spy transport capturing every outbound request the Sync_Worker issues. */
function makeFetchSpy() {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetch = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return { status: 200, json: async () => ({ sync_version: 2 }) };
  });
  return { fetch, calls };
}

/** Encrypt a record set into the seeded partition blob with the session KEK. */
async function seedPartition(
  vault: LocalVault,
  vaultType: VaultType,
  records: VaultRecord[],
): Promise<void> {
  const enc = await encrypt(utf8.encode(JSON.stringify({ records })), KEY);
  await vault.writePartition(vaultType, {
    sync_version: 1,
    iv: enc.iv,
    auth_tag: enc.authTag,
    ciphertext: enc.ciphertext,
  });
}

describe('native universal flow — unlock → decrypt → render (5.2, 5.4)', () => {
  let vault: LocalVault;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
  });

  it('authenticates, establishes the KEK, hydrates, and renders decrypted PHI', async () => {
    // Encrypted PHI is already at rest in the Local_Vault before unlock.
    await seedPartition(vault, 'medications', [
      { id: 'm1', op_timestamp: '2026-01-01T00:00:00Z', drugName: 'metformin' } as MedRec,
    ]);

    const { fetch } = makeFetchSpy();
    const controller = await createMobileHome({
      baseUrl: 'https://patient.example.com',
      secureStore: makeSecureStore(),
      biometrics,
      codec,
      fetch,
      vault,
    });

    // Authenticate to the Sync_Backend (Requirement 4.1).
    controller.signIn({ kind: 'application-password', username: 'u', applicationPassword: 'p' });
    expect(controller.getStatus()).toBe('locked');

    // Establish the KEK → hydrate by decrypting partitions from the Local_Vault.
    const result = await controller.unlockWithKek(KEY);
    expect(result).toEqual({ ok: true, status: 'ready' });

    // The rendered projection is the DECRYPTED record read locally (5.2).
    const projection = controller.read<MedRec>('medications');
    expect(projection.records).toEqual([
      { id: 'm1', op_timestamp: '2026-01-01T00:00:00Z', drugName: 'metformin' },
    ]);
    // Rendering never touched the network (5.2).
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('native universal flow — local write → enqueue → sync (5.2, 5.4)', () => {
  it('persists locally first, then enqueues and pushes only the blind envelope', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    await seedPartition(vault, 'medications', []);
    const { fetch, calls } = makeFetchSpy();

    const controller = await createMobileHome({
      baseUrl: 'https://patient.example.com',
      secureStore: makeSecureStore(),
      biometrics,
      codec,
      fetch,
      vault,
    });
    controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(KEY);

    const commit = await controller.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm2', op_timestamp: '2026-02-02T00:00:00Z', drugName: 'lisinopril' },
    ]);
    expect(commit.ok).toBe(true);

    // Local-first: the write is durable and readable WITHOUT any sync (5.4).
    expect(controller.read<MedRec>('medications').records).toHaveLength(1);
    const atRest = await vault.readPartition('medications');
    expect(atRest).not.toBeNull();
    // What is stored is ciphertext, not plaintext PHI.
    expect(atRest?.ciphertext).not.toContain('lisinopril');
    // ...but it decrypts back to the committed record with the session KEK.
    const roundTrip = await decrypt(
      { iv: atRest!.iv, authTag: atRest!.auth_tag, ciphertext: atRest!.ciphertext },
      KEY,
    );
    expect(roundTrip.ok).toBe(true);

    // The commit enqueued a background sync (5.6). Drive it deterministically.
    const outcome = await controller.coordinator.syncNow('medications');
    expect(outcome.status).toBe('synced');

    // Exactly the blind envelope crossed the boundary — no plaintext PHI.
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
    expect(post!.url).toMatch(/\/vault\/medications$/);
    expect(post!.headers.Authorization).toBeTruthy();
    const body = JSON.parse(post!.body ?? '{}');
    expect(Object.keys(body).sort()).toEqual(['auth_tag', 'ciphertext', 'iv', 'sync_version']);
    expect(post!.body).not.toContain('lisinopril');
  });
});

describe('native universal flow — lock clears the store (3.6, 3.7)', () => {
  it('discards PHI projections and the KEK on lock, blocking reads until re-unlock', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    await seedPartition(vault, 'symptoms', []);
    const secureStore = makeSecureStore();
    const { fetch } = makeFetchSpy();

    const controller = await createMobileHome({
      baseUrl: 'https://patient.example.com',
      secureStore,
      biometrics,
      codec,
      fetch,
      vault,
    });
    controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(KEY);

    await controller.commit<MedRec>('symptoms', (cur) => [
      ...cur,
      { id: 's1', op_timestamp: '2026-03-03T00:00:00Z', drugName: 'n/a' } as MedRec,
    ]);
    expect(controller.read<MedRec>('symptoms').records).toHaveLength(1);

    // Lock: the KEK and every PHI projection are discarded together (3.6, 3.7).
    await controller.lock.lock();
    expect(controller.getStatus()).toBe('locked');
    expect(controller.coordinator.read('symptoms').records).toEqual([]);
    // A commit is impossible while locked — PHI is inaccessible (3.8).
    const blocked = await controller.commit<MedRec>('symptoms', (cur) => cur);
    expect(blocked.ok).toBe(false);

    // The ciphertext at rest survives the lock unchanged (Requirement 22.5).
    expect(await vault.readPartition('symptoms')).not.toBeNull();

    // Re-unlock via the Secure Enclave biometric challenge re-hydrates the PHI.
    const reunlock = await controller.unlock();
    expect(reunlock).toEqual({ ok: true, status: 'ready' });
    expect(controller.read<MedRec>('symptoms').records).toHaveLength(1);
  });
});

// ===========================================================================
// Shell wiring integration — full flow (task 10.1)
//
// Exercises the COMPLETE composition through `createMobileApp`: onboarding →
// eligible → unlock → home → subsystem. Validates that the route tree
// composition root wires the age gate, Home_Controller, and subsystem partitions
// in the correct sequence across a mocked native runtime.
//
// Requirements: 3.6, 4.1, 8.1, 14.1
// ===========================================================================

describe('native shell wiring — onboarding → eligible → unlock → home → subsystem (3.6, 4.1, 8.1, 14.1)', () => {
  /** In-memory DeviceFlagStorage for the ineligibility flag. */
  function makeInMemoryFlagStorage(): import('@complex-patient/ui').DeviceFlagStorage {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
  }

  it('drives the full flow: age-gate → eligible → createHome → signIn → unlock → read subsystem partitions', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    // Seed medication and symptom data at rest (encrypted).
    await seedPartition(vault, 'medications', [
      { id: 'm1', op_timestamp: '2026-01-01T00:00:00Z', drugName: 'metformin' } as MedRec,
    ]);
    await seedPartition(vault, 'symptoms', [
      { id: 's1', op_timestamp: '2026-02-01T00:00:00Z', drugName: 'fatigue' } as MedRec,
    ]);

    const { fetch } = makeFetchSpy();

    // Step 1: Create the mobile app bundle (onboarding + deferred home).
    const app = createMobileApp({
      baseUrl: 'https://patient.example.com',
      secureStore: makeSecureStore(),
      biometrics,
      codec,
      fetch,
      vault,
      ineligibilityStorage: makeInMemoryFlagStorage(),
    });

    // Step 2: Onboarding — start() should report 'age-gate' (no prior flag).
    const startStatus = await app.onboarding.start();
    expect(startStatus).toBe('age-gate');
    expect(app.onboarding.getStatus()).toBe('age-gate');

    // Step 3: Submit an eligible age (well over 18). Use a fixed "now" by
    // providing a birth year/month that guarantees eligibility.
    const ageResult = await app.onboarding.submitAge({ birthMonth: 1, birthYear: 1990 });
    expect(ageResult).toEqual({ ok: true, eligible: true });
    expect(app.onboarding.getStatus()).toBe('eligible');
    expect(app.onboarding.isEligible()).toBe(true);

    // Step 4: createHome() is only allowed AFTER eligibility (Requirement 3.7).
    const controller = await app.createHome();
    expect(controller.getStatus()).toBe('signed-out');

    // Step 5: Sign in (Requirement 4.1).
    controller.signIn({ kind: 'application-password', username: 'u', applicationPassword: 'p' });
    expect(controller.getStatus()).toBe('locked');

    // Step 6: Unlock with KEK → ready (Requirements 8.1, 14.1).
    const unlockResult = await controller.unlockWithKek(KEY);
    expect(unlockResult).toEqual({ ok: true, status: 'ready' });
    expect(controller.getStatus()).toBe('ready');

    // Step 7: Read subsystem partitions — PHI is read exclusively through
    // Home_Controller.read (Requirement 14.1).
    const meds = controller.read<MedRec>('medications');
    expect(meds.records).toEqual([
      { id: 'm1', op_timestamp: '2026-01-01T00:00:00Z', drugName: 'metformin' },
    ]);

    const symptoms = controller.read<MedRec>('symptoms');
    expect(symptoms.records).toEqual([
      { id: 's1', op_timestamp: '2026-02-01T00:00:00Z', drugName: 'fatigue' },
    ]);

    // Step 8: Write to a subsystem partition → commit through Home_Controller
    // (Requirement 14.1 — write path).
    const commit = await controller.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm2', op_timestamp: '2026-03-01T00:00:00Z', drugName: 'lisinopril' },
    ]);
    expect(commit.ok).toBe(true);
    expect(controller.read<MedRec>('medications').records).toHaveLength(2);

    // No network calls during local reads/writes (Requirement 14.1, 8.1).
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects createHome() before eligibility (Requirement 3.7)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const { fetch } = makeFetchSpy();

    const app = createMobileApp({
      baseUrl: 'https://patient.example.com',
      secureStore: makeSecureStore(),
      biometrics,
      codec,
      fetch,
      vault,
      ineligibilityStorage: makeInMemoryFlagStorage(),
    });

    // Start but don't submit age yet — still on age-gate.
    await app.onboarding.start();
    expect(app.onboarding.getStatus()).toBe('age-gate');

    // Attempt to build home before eligible → rejected.
    await expect(app.createHome()).rejects.toThrow(/eligibility/i);
  });

  it('persists ineligibility flag and blocks home construction for ineligible users', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const { fetch } = makeFetchSpy();
    const flagStorage = makeInMemoryFlagStorage();

    const app = createMobileApp({
      baseUrl: 'https://patient.example.com',
      secureStore: makeSecureStore(),
      biometrics,
      codec,
      fetch,
      vault,
      ineligibilityStorage: flagStorage,
    });

    await app.onboarding.start();
    // Submit an age that is too young (under 18) — born this year means < 1.
    const ageResult = await app.onboarding.submitAge({ birthMonth: 1, birthYear: 2020 });
    expect(ageResult).toEqual({ ok: true, eligible: false });
    expect(app.onboarding.getStatus()).toBe('ineligible');

    // No vault or home controller is ever created for ineligible users.
    await expect(app.createHome()).rejects.toThrow(/eligibility/i);

    // On a subsequent launch the persisted flag causes start() to report ineligible.
    const app2 = createMobileApp({
      baseUrl: 'https://patient.example.com',
      secureStore: makeSecureStore(),
      biometrics,
      codec,
      fetch,
      vault,
      ineligibilityStorage: flagStorage,
    });
    const secondStart = await app2.onboarding.start();
    expect(secondStart).toBe('ineligible');
  });

  it('lock after home-ready clears all subsystem reads (Requirement 3.6)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    await seedPartition(vault, 'medications', [
      { id: 'm1', op_timestamp: '2026-01-01T00:00:00Z', drugName: 'atorvastatin' } as MedRec,
    ]);
    const { fetch } = makeFetchSpy();

    const app = createMobileApp({
      baseUrl: 'https://patient.example.com',
      secureStore: makeSecureStore(),
      biometrics,
      codec,
      fetch,
      vault,
      ineligibilityStorage: makeInMemoryFlagStorage(),
    });

    await app.onboarding.start();
    await app.onboarding.submitAge({ birthMonth: 6, birthYear: 1985 });
    const controller = await app.createHome();
    controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(KEY);
    expect(controller.getStatus()).toBe('ready');
    expect(controller.read<MedRec>('medications').records).toHaveLength(1);

    // Lock → all PHI cleared.
    await controller.lock.lock();
    expect(controller.getStatus()).toBe('locked');
    expect(controller.coordinator.read('medications').records).toEqual([]);

    // Re-unlock → subsystem data accessible again.
    const reunlock = await controller.unlock();
    expect(reunlock).toEqual({ ok: true, status: 'ready' });
    expect(controller.read<MedRec>('medications').records).toHaveLength(1);
  });
});
