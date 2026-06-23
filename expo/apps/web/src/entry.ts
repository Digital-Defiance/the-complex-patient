/**
 * @complex-patient/web — React Native Web entry point
 *
 * Composes the SHARED authenticated-home controller from `@complex-patient/ui`
 * (task 15.3) with the web platform adapters, so the browser presents the exact
 * same feature surface as native from one shared codebase (Requirements 22.1,
 * 22.2). Web-specific pieces injected here:
 *
 * - **HTTPS + window.crypto.subtle** — the Crypto_Engine selects the
 *   `web-subtle` provider over a secure context (Requirement 1.6); this entry
 *   refuses to start outside a secure context so no crypto runs over plain HTTP
 *   (Requirement 1.8). The Sync_Backend origin must be HTTPS (Requirement 22.1).
 * - **{@link WebSessionKeyStore}** holds the KEK in volatile RAM only and
 *   discards it on tab close/reload (Requirements 3.5, 3.6).
 *
 * The KEK is derived in-browser via `@complex-patient/crypto-engine`; the
 * Master_Passphrase and KEK never cross the network, which is authenticated
 * solely by the WordPress JWT / Application Password credential (Requirements
 * 4.1, 4.8, 1.3).
 */

import { createLocalVault, MemoryStorageBackend, type LocalVault } from '@complex-patient/local-vault';
import { createPlatformVaultStorageBackend } from '../../platform-vault-storage';
import { encrypt, decrypt, detectRuntimeContext, selectProvider } from '@complex-patient/crypto-engine';
import {
  IdleAutoLock,
  WebSessionKeyStore,
  type LifecycleAdapter,
} from '@complex-patient/key-store';
import {
  createAgeGateOnboarding,
  createAuthProvider,
  createDeviceIneligibilityFlagStore,
  type MutableAuthProvider,
  createHomeEntry,
  createSyncWorker,
  createVaultHttpClient,
  createVaultStore,
  createDeviceIdStorage,
  getOrCreateDeviceId,
  type AgeGateOnboardingController,
  type DeviceFlagStorage,
  type FetchLike,
  type HomeEntryController,
} from '@complex-patient/ui';
import { createLocalStorageFlagStorage } from '../../device-flag-storage';
import { inferAgeEligibleFromWebVault } from './infer-age-eligible';
import { loadAuthFromSession, saveAuthToSession } from './auth-session-storage';

/** Raised when the web app is loaded outside a secure (HTTPS) context (1.8). */
export class SecureContextRequiredError extends Error {
  constructor() {
    super('the web client requires a secure (HTTPS) context with window.crypto.subtle');
    this.name = 'SecureContextRequiredError';
  }
}

/** Web platform options supplied by the React Native Web host. */
export interface WebEntryOptions {
  /** HTTPS Sync_Backend origin (Requirement 22.1). */
  baseUrl: string;
  /** Tab close/reload hook to discard the KEK (Requirement 3.6). */
  lifecycle?: LifecycleAdapter;
  /** Optional transport override; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Optional in-memory vault for tests; defaults to the encrypted Local_Vault. */
  vault?: LocalVault;
  /**
   * Optional override of the runtime secure-context check. Defaults to
   * detecting `window.isSecureContext` + `window.crypto.subtle`. Tests inject
   * `true` to run under the vitest node environment.
   */
  assumeSecureContext?: boolean;
  /**
   * Device key-value store backing the age-gate ineligibility flag, kept
   * OUTSIDE the encrypted Local_Vault so it is readable at launch without a KEK
   * (Requirements 23.7, 23.8). On web this is backed by `localStorage`.
   * Optional so tests can inject an in-memory stub.
   */
  ineligibilityStorage?: DeviceFlagStorage;
}

/**
 * The web onboarding + home bundle. The React Native Web root drives the
 * age-gate {@link AgeGateOnboardingController} first (Requirement 23.1); only
 * once it reports `eligible` does it construct the {@link HomeEntryController}
 * sign-in / unlock surface via {@link WebApp.createHome}. Deferring home
 * construction guarantees no KEK derivation or Local_Vault creation happens for
 * an ineligible user (Requirements 23.1, 23.5).
 */
export interface WebApp {
  /** Age-eligibility gate: the FIRST onboarding step (Requirement 23). */
  onboarding: AgeGateOnboardingController;
  /**
   * Construct the authenticated-home controller. The host MUST call this only
   * after {@link AgeGateOnboardingController.isEligible} is true; calling it
   * earlier is rejected so an ineligible user never causes a vault to be built.
   */
  createHome(): Promise<HomeEntryController>;
}

/**
 * Build the web authenticated-home controller. Called once by the React Native
 * Web root; components subscribe to the shared controller's state.
 *
 * @throws {SecureContextRequiredError} when the runtime is not a secure web
 * context with SubtleCrypto available (Requirement 1.8) — crypto must never run
 * over plain HTTP on web.
 */
export async function createWebHome(options: WebEntryOptions): Promise<HomeEntryController> {
  assertSecureContext(options.assumeSecureContext);

  const vault = options.vault ?? (await createLocalVault(await createPlatformVaultStorageBackend()));

  // Shared idle auto-lock (300s) drives the lock binding (Requirement 3.7).
  let controller!: HomeEntryController;
  const idle = new IdleAutoLock(() => {
    void controller.lock.lock();
  });

  // Web key store: volatile RAM only, discarded on tab close/reload (3.5, 3.6).
  // Passkey unlock defaults to browser localStorage + current hostname when omitted.
  const keyStore = new WebSessionKeyStore({
    lifecycle: options.lifecycle,
    sharedIdle: idle,
  });

  // The vault store mirrors the decrypted Local_Vault partitions (task 15.1),
  // constructed with the centralized Crypto_Engine (Requirement 22.3).
  const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });

  const auth = createWebAuthProvider();
  const deviceIdStorage = createDeviceIdStorage(
    options.ineligibilityStorage ?? createLocalStorageFlagStorage(),
  );
  const deviceId = await getOrCreateDeviceId(deviceIdStorage);
  const http = createVaultHttpClient({
    baseUrl: options.baseUrl,
    auth,
    fetch: options.fetch,
    getDeviceId: () => deviceId,
  });
  const syncWorker = createSyncWorker({ http, vault, keyStore });

  controller = createHomeEntry({
    keyStore,
    store,
    syncWorker,
    auth,
    idle,
    vault,
    vaultHttp: http,
    getActiveKek: () => keyStore.getKek(),
    deviceIdStorage,
  });

  return controller;
}

/**
 * Build the web onboarding + home bundle (Requirement 23). The React Native Web
 * root calls this once and:
 *  1. calls `onboarding.start()` to check the persisted ineligibility flag
 *     BEFORE presenting any onboarding step (Requirement 23.8),
 *  2. presents the age screen and routes input through `onboarding.submitAge`,
 *  3. calls `createHome()` ONLY once `onboarding.isEligible()` is true, so no
 *     KEK derivation or Local_Vault creation occurs for an ineligible user
 *     (Requirements 23.1, 23.5).
 *
 * The ineligibility flag is persisted outside the Local_Vault via the injected
 * device storage (`localStorage`); birth month/year are used only for the
 * in-memory check and are never transmitted (Requirement 23.10).
 *
 * Note: the secure-context check is deferred to {@link createHome} (crypto runs
 * only when the vault is created), so the age screen can be presented before
 * any crypto provider is selected.
 */
export function createWebApp(options: WebEntryOptions): WebApp {
  if (options.ineligibilityStorage === undefined) {
    throw new Error('createWebApp requires an ineligibilityStorage adapter (Requirement 23.7)');
  }
  const flagStore = createDeviceIneligibilityFlagStore(options.ineligibilityStorage);
  const onboarding = createAgeGateOnboarding({
    flagStore,
    inferAgeEligibleFromDevice: inferAgeEligibleFromWebVault,
  });

  async function createHome(): Promise<HomeEntryController> {
    if (!onboarding.isEligible()) {
      throw new Error('age eligibility must be confirmed before creating the home (Requirement 23.1)');
    }
    return createWebHome(options);
  }

  return { onboarding, createHome };
}

/** Tab-session auth so reload within the same tab keeps sync credentials. */
function createWebAuthProvider(): MutableAuthProvider {
  const base = createAuthProvider(loadAuthFromSession());
  return {
    getAuth: () => base.getAuth(),
    setAuth: (credential) => {
      base.setAuth(credential);
      saveAuthToSession(credential);
    },
  };
}

/**
 * Enforce that crypto runs only in a secure web context (Requirement 1.8).
 * Mirrors the Crypto_Engine `selectProvider` refusal so the entry point and the
 * engine agree on when the web target may operate.
 */
function assertSecureContext(assume?: boolean): void {
  if (assume === true) {
    return;
  }
  const decision = selectProvider(detectRuntimeContext());
  if ('refuse' in decision && decision.refuse === 'SECURE_CONTEXT_REQUIRED') {
    throw new SecureContextRequiredError();
  }
}
