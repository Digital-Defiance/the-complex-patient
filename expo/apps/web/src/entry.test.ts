import { describe, it, expect, vi } from 'vitest';
import { createLocalVault, MemoryStorageBackend } from '@complex-patient/local-vault';
import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { VaultRecord } from '@complex-patient/domain';
import { createWebHome, createWebApp, SecureContextRequiredError } from './entry';

/**
 * Web entry-point tests (task 15.3): the web app composes the shared
 * authenticated-home controller, requires a secure (HTTPS) context with
 * window.crypto.subtle (Requirements 1.8, 22.1), and presents the home from the
 * shared codebase with identical feature parity (Requirement 22.2),
 * authenticated to the Sync_Backend via WordPress credentials (Requirement 4.1).
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(5));

interface MedRec extends VaultRecord {
  drugName: string;
}

function okFetch() {
  return vi.fn(async () => ({ status: 200, json: async () => ({ sync_version: 1 }) }));
}

async function buildController() {
  const vault = await createLocalVault(new MemoryStorageBackend());
  return createWebHome({
    baseUrl: 'https://patient.example.com',
    fetch: okFetch(),
    vault,
    assumeSecureContext: true,
  });
}

describe('createWebHome — secure context (1.8)', () => {
  it('refuses to start outside a secure web context', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    // The vitest node environment has no window → detectRuntimeContext reports
    // non-web, which selectProvider treats as native (expo-crypto), NOT a
    // refusal. So we simulate a non-secure web context directly.
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    const priorWindow = g.window;
    const priorDocument = g.document;
    g.window = { isSecureContext: false, crypto: {} };
    g.document = {};
    try {
      await expect(
        createWebHome({ baseUrl: 'https://patient.example.com', fetch: okFetch(), vault }),
      ).rejects.toBeInstanceOf(SecureContextRequiredError);
    } finally {
      g.window = priorWindow;
      g.document = priorDocument;
    }
  });

  it('starts when the secure context is assumed (test/dev runtime)', async () => {
    const controller = await buildController();
    expect(controller.getStatus()).toBe('signed-out');
  });

  it('rejects a non-HTTPS Sync_Backend origin (22.1)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    await expect(
      createWebHome({
        baseUrl: 'http://patient.example.com',
        fetch: okFetch(),
        vault,
        assumeSecureContext: true,
      }),
    ).rejects.toThrow(/https/i);
  });
});

describe('createWebHome — auth + feature parity (4.1, 22.2)', () => {
  it('reaches ready after sign-in + KEK unlock and supports CRUD', async () => {
    const controller = await buildController();
    controller.signIn({ kind: 'jwt', token: 'jwt' });
    expect(controller.getStatus()).toBe('locked');

    const result = await controller.unlockWithKek(KEY);
    expect(result).toEqual({ ok: true, status: 'ready' });

    const commit = await controller.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm1', op_timestamp: 't', drugName: 'aspirin' },
    ]);
    expect(commit.ok).toBe(true);
    expect(controller.read<MedRec>('medications').records).toHaveLength(1);
  });

  it('discards the KEK on lock so re-entry is required (3.6)', async () => {
    const controller = await buildController();
    controller.signIn({ kind: 'jwt', token: 'jwt' });
    await controller.unlockWithKek(KEY);
    expect(controller.getStatus()).toBe('ready');

    await controller.lock.lock();
    expect(controller.getStatus()).toBe('locked');

    // Web has no persistent key store; unlock without re-deriving demands the passphrase.
    const result = await controller.unlock();
    expect(result).toEqual({ ok: false, reason: 'PASSPHRASE_REQUIRED' });
  });
});

/**
 * Age-gate onboarding wiring (task 15.6, Requirement 23): the web app presents
 * the age gate as the FIRST step and only builds the home (KEK / vault) after
 * eligibility. The ineligibility flag lives in injected device storage
 * (`localStorage`) outside the Local_Vault.
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

describe('createWebApp — age gate before vault (Requirement 23)', () => {
  const baseOptions = () => ({
    baseUrl: 'https://patient.example.com',
    fetch: okFetch(),
    assumeSecureContext: true,
  });

  it('requires an ineligibility storage adapter (23.7)', () => {
    expect(() => createWebApp(baseOptions())).toThrow(/ineligibilityStorage/);
  });

  it('presents the age gate first and reaches home only after eligibility', async () => {
    const app = createWebApp({ ...baseOptions(), ineligibilityStorage: makeFlagStorage() });
    expect(await app.onboarding.start()).toBe('age-gate');

    await expect(app.createHome()).rejects.toThrow(/eligib/i);

    const result = await app.onboarding.submitAge({ birthMonth: 1, birthYear: 1990 });
    expect(result).toEqual({ ok: true, eligible: true });

    const home = await app.createHome();
    expect(home.getStatus()).toBe('signed-out');
  });

  it('persists the flag on ineligibility and never builds a vault (23.5, 23.7)', async () => {
    const storage = makeFlagStorage();
    const app = createWebApp({ ...baseOptions(), ineligibilityStorage: storage });
    await app.onboarding.start();

    const result = await app.onboarding.submitAge({ birthMonth: 6, birthYear: 2015 });
    expect(result).toEqual({ ok: true, eligible: false });
    expect(app.onboarding.getStatus()).toBe('ineligible');
    expect(Object.keys(storage.store)).toHaveLength(1);
    await expect(app.createHome()).rejects.toThrow(/eligib/i);
  });

  it('routes straight to the terminal screen on launch when the flag is set (23.8)', async () => {
    const storage = makeFlagStorage({ 'complex-patient.age-ineligible': 'true' });
    const app = createWebApp({ ...baseOptions(), ineligibilityStorage: storage });
    expect(await app.onboarding.start()).toBe('ineligible');
  });
});
