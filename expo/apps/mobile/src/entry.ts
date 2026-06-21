/**
 * @complex-patient/mobile — Native (iOS + Android) entry point
 *
 * Composes the SHARED authenticated-home controller from `@complex-patient/ui`
 * (task 15.3) with the native platform adapters, so iOS and Android present the
 * exact same feature surface as web from one shared codebase (Requirements
 * 22.1, 22.2). Platform-specific pieces injected here:
 *
 * - **expo-secure-store** backs the {@link NativeSessionKeyStore}, holding the
 *   KEK in the device Secure Enclave (Requirement 3.1) with biometric unlock.
 * - **expo-notifications** backs the medication-reminder push trigger
 *   (Requirement 12.2); not part of this controller but wired through the same
 *   adapter style.
 * - **Expo Router** is the navigation host: the app's route tree calls
 *   {@link createMobileHome} once and renders screens from the returned
 *   controller's status (`signed-out` → sign-in, `locked` → unlock, `ready` →
 *   home).
 *
 * The KEK is derived on-device via `@complex-patient/crypto-engine`; the
 * Master_Passphrase and KEK never leave the device and are never sent to the
 * Sync_Backend, which is authenticated solely by the WordPress JWT /
 * Application Password credential (Requirements 4.1, 4.8, 1.3).
 */

import { createLocalVault, MemoryStorageBackend, type LocalVault } from '@complex-patient/local-vault';
import { encrypt, decrypt } from '@complex-patient/crypto-engine';
import {
  IdleAutoLock,
  type BiometricAdapter,
  type KekCodec,
  type SecureStoreAdapter,
} from '@complex-patient/key-store';
import { createPlatformSessionKeyStore } from '../../session-key-store';
import {
  createAgeGateOnboarding,
  createAuthProvider,
  createDeviceIneligibilityFlagStore,
  createHomeEntry,
  createSyncWorker,
  createVaultHttpClient,
  createVaultStore,
  type AgeGateOnboardingController,
  type DeviceFlagStorage,
  type HomeEntryController,
} from '@complex-patient/ui';

/**
 * Native platform adapters supplied by the Expo runtime. These are passed in by
 * the Expo Router host so this module stays free of hard native imports and is
 * testable under vitest (Requirement 22.3 keeps crypto centralized; the entry
 * just wires adapters).
 */
export interface MobileEntryOptions {
  /** HTTPS Sync_Backend origin (Requirement 22.1). */
  baseUrl: string;
  /** expo-secure-store-backed Secure Enclave adapter (Requirement 3.1). */
  secureStore: SecureStoreAdapter;
  /** expo-local-authentication biometric adapter (Requirement 3.2). */
  biometrics: BiometricAdapter;
  /** Reversible codec between the KEK and its enclave-serialized form. */
  codec: KekCodec;
  /** Optional transport override; defaults to the global `fetch`. */
  fetch?: Parameters<typeof createVaultHttpClient>[0]['fetch'];
  /** Optional in-memory vault for tests; defaults to the encrypted Local_Vault. */
  vault?: LocalVault;
  /**
   * Device key-value store backing the age-gate ineligibility flag, kept
   * OUTSIDE the encrypted Local_Vault so it is readable at launch without a KEK
   * (Requirements 23.7, 23.8). On native this is backed by expo-secure-store /
   * AsyncStorage. Optional so tests can inject an in-memory stub.
   */
  ineligibilityStorage?: DeviceFlagStorage;
}

/**
 * The native onboarding + home bundle. The Expo Router host drives the
 * age-gate {@link AgeGateOnboardingController} first (Requirement 23.1); only
 * once it reports `eligible` does it construct the {@link HomeEntryController}
 * sign-in / unlock surface via {@link MobileApp.createHome}. Deferring home
 * construction guarantees no KEK derivation or Local_Vault creation happens for
 * an ineligible user (Requirements 23.1, 23.5).
 */
export interface MobileApp {
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
 * Build the native authenticated-home controller. Called once by the Expo
 * Router root layout; screens subscribe to `coordinator.syncStatus` and the
 * store, and drive `signIn` / `unlock` / `commit` from the shared controller.
 */
export async function createMobileHome(
  options: MobileEntryOptions,
): Promise<HomeEntryController> {
  const vault =
    options.vault ??
    (await createLocalVault(await import('../../platform-vault-storage').then((m) => m.createPlatformVaultStorageBackend())));

  // Shared idle auto-lock (300s) drives the lock binding (Requirement 3.7).
  let controller!: HomeEntryController;
  const idle = new IdleAutoLock(() => {
    void controller.lock.lock();
  });

  const keyStore = createPlatformSessionKeyStore({
    secureStore: options.secureStore,
    biometrics: options.biometrics,
    codec: options.codec,
    sharedIdle: idle,
  });

  // The vault store mirrors the decrypted Local_Vault partitions (task 15.1),
  // constructed with the centralized Crypto_Engine (Requirement 22.3).
  const store = createVaultStore({ vault, crypto: { encrypt, decrypt } });

  const auth = createAuthProvider();
  const http = createVaultHttpClient({ baseUrl: options.baseUrl, auth, fetch: options.fetch });
  const syncWorker = createSyncWorker({ http, vault, keyStore });

  controller = createHomeEntry({ keyStore, store, syncWorker, auth, idle, vault, vaultHttp: http });

  return controller;
}

/**
 * Build the native onboarding + home bundle (Requirement 23). The Expo Router
 * root layout calls this once and:
 *  1. calls `onboarding.start()` to check the persisted ineligibility flag
 *     BEFORE presenting any onboarding step (Requirement 23.8),
 *  2. presents the age screen and routes input through `onboarding.submitAge`,
 *  3. calls `createHome()` ONLY once `onboarding.isEligible()` is true, so no
 *     KEK derivation or Local_Vault creation occurs for an ineligible user
 *     (Requirements 23.1, 23.5).
 *
 * The ineligibility flag is persisted outside the Local_Vault via the injected
 * device storage (expo-secure-store / AsyncStorage); birth month/year are used
 * only for the in-memory check and are never transmitted (Requirement 23.10).
 */
export function createMobileApp(options: MobileEntryOptions): MobileApp {
  if (options.ineligibilityStorage === undefined) {
    throw new Error('createMobileApp requires an ineligibilityStorage adapter (Requirement 23.7)');
  }
  const flagStore = createDeviceIneligibilityFlagStore(options.ineligibilityStorage);
  const onboarding = createAgeGateOnboarding({ flagStore });

  async function createHome(): Promise<HomeEntryController> {
    if (!onboarding.isEligible()) {
      throw new Error('age eligibility must be confirmed before creating the home (Requirement 23.1)');
    }
    return createMobileHome(options);
  }

  return { onboarding, createHome };
}
