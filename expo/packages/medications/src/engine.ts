/**
 * @complex-patient/medications — Medication profile CRUD engine
 *
 * Implements medication profile create/edit against the Local_Vault for the
 * Polypharmacy_Engine (Requirements 10.1–10.6, 11.5).
 */

import type { MedicationProfile } from '@complex-patient/domain';
import {
  validateMedicationProfile,
  validateMedicationSchedule,
  validatePrnConfig,
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

function validateProfileShape(profile: Pick<MedicationProfile, 'drugName' | 'prescribingPhysician' | 'conditionTreated' | 'notes' | 'regimens'>):
  | { ok: false; error: 'INVALID_PROFILE'; fieldErrors: import('@complex-patient/domain').ProfileFieldError[] }
  | { ok: false; error: 'INVALID_SCHEDULE'; message: string }
  | { ok: false; error: 'INVALID_PRN_LIMIT'; message: string }
  | null {
  const fieldResult = validateMedicationProfile(profile);
  if (!fieldResult.valid) {
    return { ok: false, error: 'INVALID_PROFILE', fieldErrors: fieldResult.errors };
  }

  for (const regimen of profile.regimens) {
    const scheduleResult = validateMedicationSchedule(regimen.schedule);
    if (!scheduleResult.valid) {
      return { ok: false, error: 'INVALID_SCHEDULE', message: scheduleResult.message };
    }

    if (regimen.prn !== undefined) {
      const prnResult = validatePrnConfig(regimen.prn);
      if (!prnResult.valid) {
        return { ok: false, error: 'INVALID_PRN_LIMIT', message: prnResult.message };
      }
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
      prescribingPhysician: input.prescribingPhysician,
      conditionTreated: input.conditionTreated,
      active: input.active,
      regimens: input.regimens,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.appearance !== undefined ? { appearance: input.appearance } : {}),
      ...(input.refill !== undefined ? { refill: input.refill } : {}),
      ...(input.productCode !== undefined ? { productCode: input.productCode } : {}),
      ...(input.rxcui !== undefined ? { rxcui: input.rxcui } : {}),
      ...(input.ingredientRxcui !== undefined ? { ingredientRxcui: input.ingredientRxcui } : {}),
      ...(input.rxDisplayName !== undefined ? { rxDisplayName: input.rxDisplayName } : {}),
      ...(input.rxMatchConfidence !== undefined ? { rxMatchConfidence: input.rxMatchConfidence } : {}),
      ...(input.userConfirmedRxMatch !== undefined ? { userConfirmedRxMatch: input.userConfirmedRxMatch } : {}),
      ...(input.rxnormDatasetVersion !== undefined ? { rxnormDatasetVersion: input.rxnormDatasetVersion } : {}),
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

  async update(id: string, edit: MedicationProfileEdit): Promise<UpdateProfileResult> {
    const state = await readMedicationPartition(this.store, this.crypto, this.kek);
    const index = state.records.findIndex((r) => r.id === id && r.deleted !== true);

    if (index === -1) {
      return {
        ok: false,
        error: 'NOT_FOUND',
        message: `medication profile not found: ${id}`,
      };
    }

    const existing = state.records[index];

    const merged: MedicationProfile = {
      ...existing,
      ...(edit.drugName !== undefined ? { drugName: edit.drugName } : {}),
      ...(edit.prescribingPhysician !== undefined
        ? { prescribingPhysician: edit.prescribingPhysician }
        : {}),
      ...(edit.conditionTreated !== undefined
        ? { conditionTreated: edit.conditionTreated }
        : {}),
      ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
      ...(edit.active !== undefined ? { active: edit.active } : {}),
      ...(edit.regimens !== undefined ? { regimens: edit.regimens } : {}),
      ...(edit.appearance !== undefined ? { appearance: edit.appearance } : {}),
      ...(edit.refill !== undefined ? { refill: edit.refill } : {}),
      ...(edit.productCode !== undefined ? { productCode: edit.productCode } : {}),
      ...(edit.rxcui !== undefined ? { rxcui: edit.rxcui } : {}),
      ...(edit.ingredientRxcui !== undefined ? { ingredientRxcui: edit.ingredientRxcui } : {}),
      ...(edit.rxDisplayName !== undefined ? { rxDisplayName: edit.rxDisplayName } : {}),
      ...(edit.rxMatchConfidence !== undefined ? { rxMatchConfidence: edit.rxMatchConfidence } : {}),
      ...(edit.userConfirmedRxMatch !== undefined ? { userConfirmedRxMatch: edit.userConfirmedRxMatch } : {}),
      ...(edit.rxnormDatasetVersion !== undefined ? { rxnormDatasetVersion: edit.rxnormDatasetVersion } : {}),
    };

    if (edit.userConfirmedRxMatch === false) {
      delete merged.rxcui;
      delete merged.ingredientRxcui;
      delete merged.rxDisplayName;
      delete merged.rxMatchConfidence;
    }

    const failure = validateProfileShape(merged);
    if (failure !== null) {
      return failure;
    }

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

function defaultIdFactory(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
