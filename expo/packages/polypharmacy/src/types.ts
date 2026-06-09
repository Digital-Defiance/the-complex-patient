/**
 * @complex-patient/polypharmacy — Type definitions
 *
 * Dependency-injection seams and result types for the Polypharmacy_Engine
 * medication-profile CRUD layer (Requirements 10.1–10.6, 11.5).
 *
 * The engine operates on *decrypted* {@link MedicationProfile} records and
 * persists them through an injected crypto + Local_Vault layer, so the core
 * logic is testable under vitest without a native crypto/storage runtime.
 */

import type { CryptoKeyRef, EncryptedPayload, DecryptResult } from '@complex-patient/crypto-engine';
import type { ProfileFieldError } from '@complex-patient/domain';

/**
 * The subset of the Crypto_Engine the gateway depends on.
 *
 * Matches the `encrypt` / `decrypt` functions exported from
 * `@complex-patient/crypto-engine`, narrowed to a structural interface so it
 * can be injected and substituted in tests (Requirement 2.x is owned by the
 * Crypto_Engine; the engine only consumes the verified interface).
 */
export interface VaultCrypto {
  encrypt(plaintext: Uint8Array, kek: CryptoKeyRef): Promise<EncryptedPayload>;
  decrypt(blob: EncryptedPayload, kek: CryptoKeyRef): Promise<DecryptResult>;
}

/**
 * The subset of the Local_Vault the gateway depends on: read and atomic write
 * of the `medications` partition blob (Requirements 5.4, 10.3, 10.4).
 *
 * Declared structurally to avoid a hard type coupling to the concrete
 * `LocalVault` while remaining assignable from it.
 */
export interface MedicationVaultStore {
  readPartition(vaultType: 'medications'): Promise<VaultBlobLike | null>;
  writePartition(vaultType: 'medications', blob: VaultBlobLike): Promise<void>;
}

/**
 * The encrypted envelope persisted per partition. Mirrors
 * `@complex-patient/local-vault` `VaultBlob`.
 */
export interface VaultBlobLike {
  sync_version: number;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

/** Produces unique record identifiers (UUIDs) for new profiles (8.7). */
export type IdFactory = () => string;

/** Returns the current client-side operational timestamp as ISO 8601 (10.5). */
export type Clock = () => string;

/**
 * Fields a caller supplies to create a medication profile.
 * The engine assigns `id` and `op_timestamp`.
 */
export type MedicationProfileInput = {
  drugName: string;
  dosage: string;
  form: string;
  prescribingPhysician: string;
  conditionTreated: string;
  active: boolean;
  schedule: import('@complex-patient/domain').MedicationSchedule;
  prn?: import('@complex-patient/domain').PrnConfig;
};

/**
 * Fields a caller may change when editing a profile. `id` selects the target;
 * any omitted field retains its prior value.
 */
export type MedicationProfileEdit = Partial<MedicationProfileInput>;

/** Error codes surfaced by the engine. */
export type MedicationEngineErrorCode =
  | 'INVALID_PROFILE'
  | 'INVALID_SCHEDULE'
  | 'INVALID_PRN_LIMIT'
  | 'NOT_FOUND';

import type { MedicationProfile } from '@complex-patient/domain';

/** Result of a create operation (Requirements 10.1, 10.2, 10.3, 11.5). */
export type CreateProfileResult =
  | { ok: true; profile: MedicationProfile }
  | { ok: false; error: 'INVALID_PROFILE'; fieldErrors: ProfileFieldError[] }
  | { ok: false; error: 'INVALID_SCHEDULE'; message: string }
  | { ok: false; error: 'INVALID_PRN_LIMIT'; message: string };

/** Result of an update operation (Requirements 10.4, 10.5, 10.6, 11.5). */
export type UpdateProfileResult =
  | { ok: true; profile: MedicationProfile }
  | { ok: false; error: 'NOT_FOUND'; message: string }
  | { ok: false; error: 'INVALID_PROFILE'; fieldErrors: ProfileFieldError[] }
  | { ok: false; error: 'INVALID_SCHEDULE'; message: string }
  | { ok: false; error: 'INVALID_PRN_LIMIT'; message: string };
