import { describe, it, expect, vi } from 'vitest';
import { createLocalVault, MemoryStorageBackend } from '@complex-patient/local-vault';
import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type {
  BiometricAdapter,
  KekCodec,
  SecureStoreAdapter,
} from '@complex-patient/key-store';
import type { VaultRecord } from '@complex-patient/domain';
import { createMobileHome, createMobileApp } from './entry';

/**
 * Native entry-point tests (task 15.3): the mobile app composes the shared
 * authenticated-home controller with expo-secure-store + biometric adapters and
 * presents the home from the shared codebase (Requirements 22.1, 22.2),
 * authenticated to the Sync_Backend via WordPress credentials (Requirement 4.1).
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(3));

interface MedRec extends VaultRecord {
  drugName: string;
}

const codec: KekCodec = {
  serialize: () => 'serialized-kek',
  deserialize: () => KEY,
};

function makeSecureStore(): SecureStoreAdapter {
  let stored: string | null = null;
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

const biometrics: BiometricAdapter = {
  isAvailable: async () => true,
  authenticate: async () => true,
};

async function buildController(fetchImpl = vi.fn(async () => ({ status: 200, json: async () => ({ sync_version: 1 }) }))) {
  const vault = await createLocalVault(new MemoryStorageBackend());
  return createMobileHome({
    baseUrl: 'https://patient.example.com',
    secureStore: makeSecureStore(),
    biometrics,
    codec,
    fetch: fetchImpl,
    vault,
  });
}

describe('createMobileHome', () => {
  it('starts signed-out and reaches ready after sign-in + KEK unlock', async () => {
    const controller = await buildController();
    expect(controller.getStatus()).toBe('signed-out');

    await controller.signIn({ kind: 'application-password', username: 'u', applicationPassword: 'p' });
    expect(controller.getStatus()).toBe('locked');

    const result = await controller.unlockWithKek(KEY);
    expect(result).toEqual({ ok: true, status: 'ready' });
  });

  it('supports offline-first CRUD identically to web (22.2)', async () => {
    const controller = await buildController();
    await controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(KEY);

    const result = await controller.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm1', op_timestamp: 't', drugName: 'aspirin' },
    ]);
    expect(result.ok).toBe(true);
    expect(controller.read<MedRec>('medications').records).toHaveLength(1);
  });

  it('rejects a non-HTTPS Sync_Backend origin (22.1)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    await expect(
      createMobileHome({
        baseUrl: 'http://patient.example.com',
        secureStore: makeSecureStore(),
        biometrics,
        codec,
        vault,
      }),
    ).rejects.toThrow(/https/i);
  });
});

/**
 * Age-gate onboarding wiring (task 15.6, Requirement 23): the native app
 * presents the age gate as the FIRST step and only builds the home (KEK / vault)
 * after eligibility. The ineligibility flag lives in injected device storage
 * (expo-secure-store / AsyncStorage) outside the Local_Vault.
 */
function makeFlagStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

describe('createMobileApp — age gate before vault (Requirement 23)', () => {
  const baseOptions = () => ({
    baseUrl: 'https://patient.example.com',
    secureStore: makeSecureStore(),
    biometrics,
    codec,
    fetch: vi.fn(async () => ({ status: 200, json: async () => ({ sync_version: 1 }) })),
    vault: undefined as Awaited<ReturnType<typeof createLocalVault>> | undefined,
  });

  it('requires an ineligibility storage adapter (23.7)', () => {
    expect(() => createMobileApp(baseOptions())).toThrow(/ineligibilityStorage/);
  });

  it('presents the age gate first and reaches home only after eligibility', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const app = createMobileApp({ ...baseOptions(), vault, ineligibilityStorage: makeFlagStorage() });
    expect(await app.onboarding.start()).toBe('age-gate');

    // Home construction is blocked until age eligibility is confirmed (23.1).
    await expect(app.createHome()).rejects.toThrow(/eligib/i);

    const result = await app.onboarding.submitAge({ birthMonth: 1, birthYear: 1990 });
    expect(result).toEqual({ ok: true, eligible: true });

    const home = await app.createHome();
    expect(home.getStatus()).toBe('signed-out');
  });

  it('persists the flag on ineligibility and never builds a vault (23.5, 23.7)', async () => {
    const storage = makeFlagStorage();
    const app = createMobileApp({ ...baseOptions(), ineligibilityStorage: storage });
    await app.onboarding.start();

    const result = await app.onboarding.submitAge({ birthMonth: 6, birthYear: 2015 });
    expect(result).toEqual({ ok: true, eligible: false });
    expect(app.onboarding.getStatus()).toBe('ineligible');
    expect(Object.keys(storage.store)).toHaveLength(1);
    await expect(app.createHome()).rejects.toThrow(/eligib/i);
  });

  it('routes straight to the terminal screen on launch when the flag is set (23.8)', async () => {
    const storage = makeFlagStorage({ 'complex-patient.age-ineligible': 'true' });
    const app = createMobileApp({ ...baseOptions(), ineligibilityStorage: storage });
    expect(await app.onboarding.start()).toBe('ineligible');
  });
});
