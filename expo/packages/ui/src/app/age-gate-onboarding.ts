/**
 * @complex-patient/ui — Age-gate onboarding controller (Requirement 23)
 *
 * The age gate is the FIRST onboarding step. It runs before Master_Passphrase
 * setup and before any KEK derivation or Local_Vault creation, so an ineligible
 * user never causes an encrypted vault to be created (Requirements 23.1, 23.5).
 *
 * This module is the platform-agnostic, headless, dependency-injected glue that
 * binds the pure {@link evaluateAgeGate} rule (task 2.5, `@complex-patient/
 * domain`) to a persisted ineligibility flag. Like the other `app/` modules
 * (auth, home-entry) it takes every collaborator as an injected adapter so the
 * exact same flow runs on native and web — only the concrete flag storage
 * differs (expo-secure-store / AsyncStorage on native, `localStorage` on web).
 *
 * Flow (design.md → "Age Eligibility Gate"):
 *
 *   launch → flag set? ── yes ─→ terminal ineligibility (no age screen)
 *                       └─ no ──→ age screen (birth month + year)
 *                                   │ evaluateAgeGate
 *                                   ├─ INVALID_AGE_INPUT → re-prompt (stay)
 *                                   ├─ eligible:false → persist flag → terminal
 *                                   └─ eligible:true → proceed to passphrase
 *
 * Privacy invariants (Requirement 23.10): birth month/year are collected solely
 * for the in-memory {@link evaluateAgeGate} call. This controller never stores
 * them, never returns them, and never places them in any Sync_Backend request —
 * only the boolean ineligibility flag is ever persisted, and that flag lives
 * OUTSIDE the encrypted Local_Vault so it is readable at launch without a KEK
 * (Requirements 23.7, 23.8).
 */

import { evaluateAgeGate, type AgeGateInput } from '@complex-patient/domain';

/**
 * Persisted ineligibility flag, stored OUTSIDE the encrypted Local_Vault so it
 * is readable at launch without a KEK (Requirements 23.7, 23.8). The concrete
 * adapter is injected by the platform: expo-secure-store / AsyncStorage on
 * native, `localStorage` on web. The flag is not PHI and never touches the
 * vault or the KEK lifecycle.
 */
export interface IneligibilityFlagStore {
  /** Whether a prior ineligible determination was persisted on this device. */
  isIneligible(): Promise<boolean>;
  /** Persist the terminal ineligibility flag (idempotent). */
  markIneligible(): Promise<void>;
}

/**
 * Minimal device key-value seam used to back {@link IneligibilityFlagStore}.
 * Both the native (expo-secure-store / AsyncStorage) and web (`localStorage`)
 * stores satisfy this shape; sync and async implementations are both accepted.
 */
export interface DeviceFlagStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

/** Storage key for the persisted ineligibility flag (outside the Local_Vault). */
export const INELIGIBILITY_FLAG_KEY = 'complex-patient.age-ineligible';
/** Sentinel value written when the user is determined ineligible. */
export const INELIGIBILITY_FLAG_VALUE = 'true';

/**
 * Adapt a platform key-value store (expo-secure-store / AsyncStorage /
 * `localStorage`) into an {@link IneligibilityFlagStore}. Reads and writes a
 * single sentinel key outside the Local_Vault.
 */
export function createDeviceIneligibilityFlagStore(
  storage: DeviceFlagStorage,
  key: string = INELIGIBILITY_FLAG_KEY,
): IneligibilityFlagStore {
  return {
    async isIneligible(): Promise<boolean> {
      const value = await storage.getItem(key);
      return value === INELIGIBILITY_FLAG_VALUE;
    },
    async markIneligible(): Promise<void> {
      await storage.setItem(key, INELIGIBILITY_FLAG_VALUE);
    },
  };
}

/**
 * Where the onboarding flow currently is.
 *
 * - `checking`: initial, before {@link AgeGateOnboardingController.start}
 *   resolves the persisted flag — no screen committed yet.
 * - `age-gate`: present the age-eligibility screen (birth month + year) as the
 *   first onboarding step (Requirement 23.1).
 * - `ineligible`: terminal, non-recoverable ineligibility screen (Requirements
 *   23.5, 23.6, 23.8). There is no transition back to `age-gate`.
 * - `eligible`: the session is age-eligible; onboarding proceeds to
 *   Master_Passphrase setup / KEK derivation (Requirement 23.4).
 */
export type OnboardingStatus = 'checking' | 'age-gate' | 'ineligible' | 'eligible';

/**
 * Outcome of an age-screen submission.
 *
 * - `{ ok: true; eligible: true }`  — proceed to passphrase setup (23.4).
 * - `{ ok: true; eligible: false }` — blocked; flag persisted, terminal screen (23.5).
 * - `{ ok: false; error: 'INVALID_AGE_INPUT' }` — re-prompt on the age screen (23.9).
 * - `{ ok: false; error: 'NOT_ON_AGE_SCREEN' }` — submission rejected because the
 *   flow is terminal (`ineligible`) or already `eligible`; the terminal screen
 *   offers no path back to re-entry (Requirement 23.6).
 */
export type AgeSubmissionResult =
  | { ok: true; eligible: true }
  | { ok: true; eligible: false }
  | { ok: false; error: 'INVALID_AGE_INPUT' }
  | { ok: false; error: 'NOT_ON_AGE_SCREEN' };

/** Dependencies for {@link createAgeGateOnboarding}. */
export interface AgeGateOnboardingDeps {
  /** Persisted ineligibility flag, stored outside the Local_Vault (23.7, 23.8). */
  flagStore: IneligibilityFlagStore;
  /**
   * Injected clock used as the reference instant for {@link evaluateAgeGate}.
   * Defaults to `() => new Date()`; tests inject a fixed instant so eligibility
   * is deterministic.
   */
  now?: () => Date;
}

/**
 * The headless onboarding controller. The app entry points drive it: call
 * {@link start} once on launch, render the screen for {@link getStatus}, and
 * route age-screen input through {@link submitAge}. The home controller
 * (sign-in / unlock) is only reachable once {@link getStatus} is `eligible`.
 */
export interface AgeGateOnboardingController {
  /** Current onboarding screen/state. */
  getStatus(): OnboardingStatus;
  /**
   * Launch check (Requirement 23.8): read the persisted ineligibility flag
   * BEFORE presenting any onboarding step. If set, route straight to the
   * terminal ineligibility screen; otherwise present the age screen. Resolves
   * to the resulting status.
   */
  start(): Promise<OnboardingStatus>;
  /**
   * Submit the age-eligibility screen (birth month + year). Evaluates via the
   * pure {@link evaluateAgeGate}; on ineligibility persists the flag and becomes
   * terminal. The month/year are used only for this in-memory computation and
   * are never stored or transmitted (Requirement 23.10).
   */
  submitAge(input: AgeGateInput): Promise<AgeSubmissionResult>;
  /** Whether onboarding may proceed to Master_Passphrase setup (23.4). */
  isEligible(): boolean;
}

/**
 * Compose the shared age-gate onboarding controller from injected adapters.
 * This is the single source of the age-gate wiring that both `apps/mobile` and
 * `apps/web` build on, so the gate is provably identical across platforms — the
 * platform only varies the concrete flag storage adapter it passes in.
 */
export function createAgeGateOnboarding(
  deps: AgeGateOnboardingDeps,
): AgeGateOnboardingController {
  const { flagStore } = deps;
  const now = deps.now ?? (() => new Date());

  let status: OnboardingStatus = 'checking';

  function getStatus(): OnboardingStatus {
    return status;
  }

  async function start(): Promise<OnboardingStatus> {
    // Check the persisted flag FIRST, before presenting any onboarding step
    // (Requirement 23.8). A set flag routes straight to the terminal screen.
    if (await flagStore.isIneligible()) {
      status = 'ineligible';
      return status;
    }
    status = 'age-gate';
    return status;
  }

  async function submitAge(input: AgeGateInput): Promise<AgeSubmissionResult> {
    // The terminal screen is non-recoverable: once ineligible (or already
    // eligible) there is no path back to age re-entry (Requirement 23.6).
    if (status !== 'age-gate') {
      return { ok: false, error: 'NOT_ON_AGE_SCREEN' };
    }

    const result = evaluateAgeGate(input, now());

    if (!result.ok) {
      // Invalid input → re-prompt; eligibility is not computed as satisfied
      // and the flow stays on the age screen (Requirement 23.9).
      return { ok: false, error: 'INVALID_AGE_INPUT' };
    }

    if (!result.eligible) {
      // Persist the ineligibility flag outside the Local_Vault, then present the
      // terminal screen (Requirements 23.5, 23.7). No KEK/vault is created.
      await flagStore.markIneligible();
      status = 'ineligible';
      return { ok: true, eligible: false };
    }

    // Eligible → mark the session age-eligible; onboarding may proceed to
    // Master_Passphrase setup / KEK derivation (Requirement 23.4).
    status = 'eligible';
    return { ok: true, eligible: true };
  }

  function isEligible(): boolean {
    return status === 'eligible';
  }

  return { getStatus, start, submitAge, isEligible };
}
