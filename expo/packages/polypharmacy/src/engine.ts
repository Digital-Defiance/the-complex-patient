/**
 * @complex-patient/polypharmacy — Medication profile CRUD engine
 *
 * Implements medication profile create/edit against the Local_Vault for the
 * Polypharmacy_Engine (Requirements 10.1–10.6, 11.5).
 *
 * Behavioral guarantees:
 * - Create validates the five required fields and the schedule (and PRN limit
 *   when present); on any validation failure nothing is recorded and per-field
 *   / per-message errors are returned (Requirements 10.1, 10.2, 11.5).
 * - A validated profile is stored in the `medications` partition of the
 *   Local_Vault (Requirements 10.3, 11.5).
 * - Edit updates the corresponding record and records the client-side
 *   operational timestamp on update (Requirements 10.4, 10.5).
 * - Editing a profile that does not exist is rejected with NOT_FOUND and leaves
 *   existing records unchanged (Requirement 10.6).
 *
 * The engine is constructed with injected crypto + vault + id/clock seams so
 * the core logic is deterministic and testable under vitest.
 */

import type { MedicationProfile } from '@complex-patient/domain';
import {
  validateMedicationProfile,
  validateMedicationSchedule,
  validatePrnSafetyLimit,
} from '@complex-patient/domain';
import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import {
  readMedicationPartition,
  writeMedicationPartition,
} from './gateway';
import type {
  Clock,
  CreateProfileResult,
  IdFactory,
  MedicationProfileEdit,
  MedicationProfileInput,
  MedicationVaultStore,
  UpdateProfileResult,
  VaultCrypto,
} from './types';

/** Dependencies injected into the {@link MedicationProfileEngine}. */
export interface MedicationProfileEngineDeps {
  store: MedicationVaultStore;
  crypto: VaultCrypto;
  kek: CryptoKeyRef;
  /** UUID factory for new records (defaults to `crypto.randomUUID`). */
  newId?: IdFactory;
  /** Operational-timestamp clock (defaults to `() => new Date().toISOString()`). */
  now?: Clock;
}

/**
 * Validate the value-typed parts of a profile shared by create and edit:
 * the five text fields, the schedule, and the PRN safety limit when present.
 *
 * Returns `null` when valid, or a typed failure result otherwise. The failure
 * type is generic so it fits both create and update result unions.
 */
function validateProfileShape(profile: {
  drugName: string;
  dosage: string;
  form: string;
  prescribingPhysician: string;
  conditionTreated: string;
  schedule: MedicationProfile['schedule'];
  prn?: MedicationProfile['prn'];
}):
  | { ok: false; error: 'INVALID_PROFILE'; fieldErrors: import('@complex-patient/domain').ProfileFieldError[] }
  | { ok: false; error: 'INVALID_SCHEDULE'; message: string }
  | { ok: false; error: 'INVALID_PRN_LIMIT'; message: string }
  | null {
  // Five required text fields, per-field reporting, reject whole profile (10.1, 10.2).
  const fieldResult = validateMedicationProfile(profile);
  if (!fieldResult.valid) {
    return { ok: false, error: 'INVALID_PROFILE', fieldErrors: fieldResult.errors };
  }

  // Schedule validity (weekly days, interval range, taper dosage) — must store a
  // valid schedule (11.5) and reject invalid ones (11.4).
  const scheduleResult = validateMedicationSchedule(profile.schedule);
  if (!scheduleResult.valid) {
    return { ok: false, error: 'INVALID_SCHEDULE', message: scheduleResult.message };
  }

  // PRN safety limit, when a PRN config is attached (13.3, 13.4).
  if (profile.prn !== undefined) {
    const prnResult = validatePrnSafetyLimit(profile.prn.safetyLimit24h);
    if (!prnResult.valid) {
      return { ok: false, error: 'INVALID_PRN_LIMIT', message: prnResult.message };
    }
  }

  return null;
}

/**
 * Medication profile CRUD engine for the `medications` vault partition.
 */
export class MedicationProfileEngine {
  private readonly store: MedicationVaultStore;
  private readonly crypto: VaultCrypto;
  private readonly kek: CryptoKeyRef;
  private readonly newId: IdFactory;
  private readonly now: Clock;

  constructor(deps: MedicationProfileEngineDeps) {
    this.store = deps.store;
    this.crypto = deps.crypto;
    this.kek = deps.kek;
    this.newId = deps.newId ?? defaultIdFactory;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Read and decrypt all medication profiles from the Local_Vault. */
  async list(): Promise<MedicationProfile[]> {
    const state = await readMedicationPartition(this.store, this.crypto, this.kek);
    return state.records;
  }

  /** Read and decrypt a single medication profile by id, or `null` if absent. */
  async get(id: string): Promise<MedicationProfile | null> {
    const records = await this.list();
    return records.find((r) => r.id === id && r.deleted !== true) ?? null;
  }

  /**
   * Create a validated medication profile and store it in the medications
   * partition (Requirements 10.1, 10.2, 10.3, 11.5).
   *
   * On validation failure no record is created or stored; the existing
   * partition is left untouched.
   */
  async create(input: MedicationProfileInput): Promise<CreateProfileResult> {
    const failure = validateProfileShape(input);
    if (failure !== null) {
      return failure;
    }

    const state = await readMedicationPartition(this.store, this.crypto, this.kek);

    const profile: MedicationProfile = {
      id: this.newId(),
      op_timestamp: this.now(),
      drugName: input.drugName,
      dosage: input.dosage,
      form: input.form,
      prescribingPhysician: input.prescribingPhysician,
      conditionTreated: input.conditionTreated,
      active: input.active,
      schedule: input.schedule,
      ...(input.prn !== undefined ? { prn: input.prn } : {}),
    };

    const nextRecords = [...state.records, profile];
    await writeMedicationPartition(
      this.store,
      this.crypto,
      this.kek,
      nextRecords,
      state.syncVersion,
      state.prnLogs,
    );

    return { ok: true, profile };
  }

  /**
   * Save an edit to an existing medication profile, updating the corresponding
   * record in the Local_Vault and recording the client-side operational
   * timestamp of the change (Requirements 10.4, 10.5, 11.5).
   *
   * Rejects an edit referencing a profile that does not exist with NOT_FOUND,
   * leaving existing records unchanged (Requirement 10.6).
   */
  async update(id: string, edit: MedicationProfileEdit): Promise<UpdateProfileResult> {
    const state = await readMedicationPartition(this.store, this.crypto, this.kek);
    const index = state.records.findIndex((r) => r.id === id && r.deleted !== true);

    // Reject edits to non-existent profiles; leave records unchanged (10.6).
    if (index === -1) {
      return {
        ok: false,
        error: 'NOT_FOUND',
        message: `medication profile not found: ${id}`,
      };
    }

    const existing = state.records[index];

    // Build the candidate merged profile (omitted fields retain prior values).
    const merged: MedicationProfile = {
      ...existing,
      ...(edit.drugName !== undefined ? { drugName: edit.drugName } : {}),
      ...(edit.dosage !== undefined ? { dosage: edit.dosage } : {}),
      ...(edit.form !== undefined ? { form: edit.form } : {}),
      ...(edit.prescribingPhysician !== undefined
        ? { prescribingPhysician: edit.prescribingPhysician }
        : {}),
      ...(edit.conditionTreated !== undefined
        ? { conditionTreated: edit.conditionTreated }
        : {}),
      ...(edit.active !== undefined ? { active: edit.active } : {}),
      ...(edit.schedule !== undefined ? { schedule: edit.schedule } : {}),
      ...(edit.prn !== undefined ? { prn: edit.prn } : {}),
    };

    // Validate the merged result; on failure leave records unchanged (10.2, 11.4).
    const failure = validateProfileShape(merged);
    if (failure !== null) {
      return failure;
    }

    // Record the client-side operational timestamp on update (10.5).
    const updated: MedicationProfile = { ...merged, op_timestamp: this.now() };

    const nextRecords = state.records.slice();
    nextRecords[index] = updated;
    await writeMedicationPartition(
      this.store,
      this.crypto,
      this.kek,
      nextRecords,
      state.syncVersion,
      state.prnLogs,
    );

    return { ok: true, profile: updated };
  }
}

/**
 * Default UUID factory. Uses the platform `crypto.randomUUID` when available
 * (Node ≥ 16.7, modern browsers, expo), falling back to a simple RFC4122-ish
 * generator so the engine never throws for lack of a global.
 */
function defaultIdFactory(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  // Fallback: not cryptographically strong, only for environments without
  // crypto.randomUUID. Callers may inject a stronger factory.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
