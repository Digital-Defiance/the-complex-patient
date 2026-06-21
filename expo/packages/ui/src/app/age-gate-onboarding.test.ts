import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAgeGateOnboarding,
  createDeviceIneligibilityFlagStore,
  ELIGIBILITY_FLAG_KEY,
  ELIGIBILITY_FLAG_VALUE,
  INELIGIBILITY_FLAG_KEY,
  INELIGIBILITY_FLAG_VALUE,
  type DeviceFlagStorage,
  type IneligibilityFlagStore,
} from './age-gate-onboarding';

/**
 * Age-gate onboarding controller tests (Requirement 23). The controller is the
 * FIRST onboarding step: it checks the persisted ineligibility flag on launch
 * (23.8), presents the age screen, evaluates birth month/year via the pure
 * `evaluateAgeGate`, re-prompts on invalid input (23.9), persists the flag and
 * becomes terminal on ineligibility (23.5, 23.7), and proceeds on eligibility
 * (23.4). Birth month/year are never stored or transmitted (23.10).
 */

/** Reference instant: 2024-06-15 UTC. A user turning 16 by mid-2024 is eligible. */
const NOW = new Date('2024-06-15T00:00:00.000Z');

/** In-memory device storage stub standing in for expo-secure-store / localStorage. */
function makeStorage(initial: Record<string, string> = {}): DeviceFlagStorage & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

describe('createDeviceIneligibilityFlagStore (Requirements 23.7, 23.8)', () => {
  it('reports not-ineligible when no flag is persisted', async () => {
    const flagStore = createDeviceIneligibilityFlagStore(makeStorage());
    expect(await flagStore.isIneligible()).toBe(false);
  });

  it('persists the sentinel flag value under the dedicated key', async () => {
    const storage = makeStorage();
    const flagStore = createDeviceIneligibilityFlagStore(storage);
    await flagStore.markIneligible();
    expect(storage.store[INELIGIBILITY_FLAG_KEY]).toBe(INELIGIBILITY_FLAG_VALUE);
    expect(await flagStore.isIneligible()).toBe(true);
  });

  it('persists age eligibility across launches', async () => {
    const storage = makeStorage();
    const flagStore = createDeviceIneligibilityFlagStore(storage);
    await flagStore.markAgeEligible();
    expect(storage.store[ELIGIBILITY_FLAG_KEY]).toBe(ELIGIBILITY_FLAG_VALUE);
    expect(await flagStore.isAgeEligible()).toBe(true);
  });

  it('reads a pre-existing persisted flag (survives across launches)', async () => {
    const storage = makeStorage({ [INELIGIBILITY_FLAG_KEY]: INELIGIBILITY_FLAG_VALUE });
    const flagStore = createDeviceIneligibilityFlagStore(storage);
    expect(await flagStore.isIneligible()).toBe(true);
  });

  it('supports an async storage backend (AsyncStorage-style)', async () => {
    const backing: Record<string, string> = {};
    const asyncStorage: DeviceFlagStorage = {
      getItem: async (k) => (k in backing ? backing[k] : null),
      setItem: async (k, v) => {
        backing[k] = v;
      },
    };
    const flagStore = createDeviceIneligibilityFlagStore(asyncStorage);
    expect(await flagStore.isIneligible()).toBe(false);
    await flagStore.markIneligible();
    expect(await flagStore.isIneligible()).toBe(true);
  });
});

describe('createAgeGateOnboarding — launch flag check (Requirement 23.8)', () => {
  it('routes straight to the terminal ineligibility screen when the flag is set', async () => {
    const storage = makeStorage({ [INELIGIBILITY_FLAG_KEY]: INELIGIBILITY_FLAG_VALUE });
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(storage),
      now: () => NOW,
    });

    expect(onboarding.getStatus()).toBe('checking');
    const status = await onboarding.start();
    expect(status).toBe('ineligible');
    expect(onboarding.getStatus()).toBe('ineligible');
    expect(onboarding.isEligible()).toBe(false);
  });

  it('presents the age screen when no flag is persisted', async () => {
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(makeStorage()),
      now: () => NOW,
    });
    expect(await onboarding.start()).toBe('age-gate');
    expect(onboarding.getStatus()).toBe('age-gate');
  });

  it('checks the flag BEFORE accepting any age submission', async () => {
    // A submission before start() (still `checking`) is rejected as off-screen.
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(makeStorage()),
      now: () => NOW,
    });
    const result = await onboarding.submitAge({ birthMonth: 1, birthYear: 1990 });
    expect(result).toEqual({ ok: false, error: 'NOT_ON_AGE_SCREEN' });
  });
});

describe('createAgeGateOnboarding — invalid re-prompt (Requirement 23.9)', () => {
  let onboarding: ReturnType<typeof createAgeGateOnboarding>;

  beforeEach(async () => {
    onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(makeStorage()),
      now: () => NOW,
    });
    await onboarding.start();
  });

  it('rejects an out-of-range birth month and stays on the age screen', async () => {
    const result = await onboarding.submitAge({ birthMonth: 13, birthYear: 1990 });
    expect(result).toEqual({ ok: false, error: 'INVALID_AGE_INPUT' });
    expect(onboarding.getStatus()).toBe('age-gate');
    expect(onboarding.isEligible()).toBe(false);
  });

  it('rejects a future birth month/year and re-prompts', async () => {
    const result = await onboarding.submitAge({ birthMonth: 12, birthYear: 2030 });
    expect(result).toEqual({ ok: false, error: 'INVALID_AGE_INPUT' });
    expect(onboarding.getStatus()).toBe('age-gate');
  });

  it('allows a valid retry after an invalid submission', async () => {
    await onboarding.submitAge({ birthMonth: 0, birthYear: 1990 });
    expect(onboarding.getStatus()).toBe('age-gate');
    const retry = await onboarding.submitAge({ birthMonth: 1, birthYear: 1990 });
    expect(retry).toEqual({ ok: true, eligible: true });
    expect(onboarding.getStatus()).toBe('eligible');
  });
});

describe('createAgeGateOnboarding — ineligible persistence + terminal screen (Requirements 23.5, 23.6, 23.7)', () => {
  it('persists the flag outside the vault and presents the terminal screen', async () => {
    const storage = makeStorage();
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(storage),
      now: () => NOW,
    });
    await onboarding.start();

    // Born mid-2010 → not yet 16 by mid-2024.
    const result = await onboarding.submitAge({ birthMonth: 6, birthYear: 2010 });
    expect(result).toEqual({ ok: true, eligible: false });
    expect(onboarding.getStatus()).toBe('ineligible');
    // Flag persisted outside the Local_Vault so it survives launches (23.7).
    expect(storage.store[INELIGIBILITY_FLAG_KEY]).toBe(INELIGIBILITY_FLAG_VALUE);
  });

  it('is non-recoverable: offers no path back to the age screen (23.6)', async () => {
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(makeStorage()),
      now: () => NOW,
    });
    await onboarding.start();
    await onboarding.submitAge({ birthMonth: 6, birthYear: 2010 });
    expect(onboarding.getStatus()).toBe('ineligible');

    // Any further submission (e.g. retry with an eligible value) is rejected.
    const retry = await onboarding.submitAge({ birthMonth: 1, birthYear: 1990 });
    expect(retry).toEqual({ ok: false, error: 'NOT_ON_AGE_SCREEN' });
    expect(onboarding.getStatus()).toBe('ineligible');
  });
});

describe('createAgeGateOnboarding — eligible progression (Requirement 23.4)', () => {
  it('marks the session eligible so onboarding may proceed to passphrase setup', async () => {
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(makeStorage()),
      now: () => NOW,
    });
    await onboarding.start();

    const result = await onboarding.submitAge({ birthMonth: 1, birthYear: 2000 });
    expect(result).toEqual({ ok: true, eligible: true });
    expect(onboarding.getStatus()).toBe('eligible');
    expect(onboarding.isEligible()).toBe(true);
  });

  it('persists eligibility flag without storing birth month/year', async () => {
    const storage = makeStorage();
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(storage),
      now: () => NOW,
    });
    await onboarding.start();
    await onboarding.submitAge({ birthMonth: 1, birthYear: 2000 });
    expect(INELIGIBILITY_FLAG_KEY in storage.store).toBe(false);
    expect(storage.store[ELIGIBILITY_FLAG_KEY]).toBe(ELIGIBILITY_FLAG_VALUE);
  });

  it('skips the age screen when eligibility was confirmed on a prior launch', async () => {
    const storage = makeStorage({ [ELIGIBILITY_FLAG_KEY]: ELIGIBILITY_FLAG_VALUE });
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(storage),
      now: () => NOW,
    });
    await expect(onboarding.start()).resolves.toBe('eligible');
    expect(onboarding.isEligible()).toBe(true);
  });

  it('infers eligibility from an existing device vault when the flag is missing', async () => {
    const storage = makeStorage();
    const onboarding = createAgeGateOnboarding({
      flagStore: createDeviceIneligibilityFlagStore(storage),
      now: () => NOW,
      inferAgeEligibleFromDevice: async () => true,
    });
    await expect(onboarding.start()).resolves.toBe('eligible');
    expect(storage.store[ELIGIBILITY_FLAG_KEY]).toBe(ELIGIBILITY_FLAG_VALUE);
  });

  it('blocks an eligible submission after the flow is already terminal (no resurrection)', async () => {
    // Simulates a launch with the flag already set, then an attempted submit.
    const flagStore: IneligibilityFlagStore = {
      isIneligible: async () => true,
      markIneligible: async () => {},
      isAgeEligible: async () => false,
      markAgeEligible: async () => {},
    };
    const onboarding = createAgeGateOnboarding({ flagStore, now: () => NOW });
    await onboarding.start();
    expect(onboarding.getStatus()).toBe('ineligible');
    const result = await onboarding.submitAge({ birthMonth: 1, birthYear: 1990 });
    expect(result).toEqual({ ok: false, error: 'NOT_ON_AGE_SCREEN' });
  });
});
