/**
 * @complex-patient/symptom-journal — Type definitions
 *
 * The Symptom_Journal records symptom entries into the `symptoms` vault
 * partition. It operates on *decrypted* {@link SymptomEntry} records and
 * persists them through an injected store, so the encrypt/Local_Vault wiring is
 * substitutable and the journaling logic is unit-testable in isolation.
 *
 * Requirements: 15.1, 15.2, 15.6
 */

import type { Association, FlareUp, LogLocation, SymptomDraft, SymptomEntry, TimeUnit } from '@complex-patient/domain';
import type { FieldError } from '@complex-patient/domain';

/**
 * The user-entered symptom input submitted for logging. Field types are loose
 * (`unknown` where a user could supply malformed values) so validation can
 * reject and still capture the raw entry as a draft (15.6).
 */
export interface SymptomEntryInput {
  symptomType?: unknown;
  systemicLocation?: unknown;
  severity?: unknown;
  duration?: { value?: unknown; unit?: unknown } | unknown;
  notes?: unknown;
  /** Whether the symptom is currently active (eligible for flare selection, 17.1). Defaults to true. */
  active?: unknown;
  /** Optional approximate GPS when logging (opt-in). */
  location?: LogLocation;
}

/**
 * Persistence abstraction over the decrypted `symptoms` partition record set.
 *
 * Concrete implementations bridge the Local_Vault + Crypto_Engine: read decrypts
 * the `symptoms` Vault_Blob into `PartitionPayload<SymptomEntry>.records`, and
 * write serializes + encrypts the updated record set back. Injecting this keeps
 * the journaling engine free of crypto/storage concerns and testable under
 * vitest (design: Symptom_Journal → Local_Vault).
 */
export interface SymptomStore {
  /** Read all decrypted symptom records currently in the `symptoms` partition. */
  readSymptoms(): Promise<SymptomEntry[]>;
  /** Persist the full decrypted symptom record set back to the `symptoms` partition. */
  writeSymptoms(records: SymptomEntry[]): Promise<void>;
}

/**
 * Injectable side-effect dependencies, defaulted in {@link createSymptomJournal}.
 * Overriding these makes id/timestamp generation deterministic in tests.
 */
export interface SymptomJournalDeps {
  /** Generates a unique record id (UUID in production). */
  newId(): string;
  /** Returns the client-side operational timestamp as an ISO 8601 string (15.2). */
  now(): string;
}

/**
 * Result of attempting to log a symptom entry.
 *
 * - On success the validated, persisted {@link SymptomEntry} (with `id` and
 *   `op_timestamp`) is returned (15.1, 15.2).
 * - On validation rejection the per-field {@link FieldError}s plus a
 *   {@link SymptomDraft} of the entered details are returned so the captured
 *   information is not lost (15.6).
 */
export type LogSymptomResult =
  | { ok: true; entry: SymptomEntry }
  | { ok: false; errors: FieldError[]; draft: SymptomDraft };

export type { SymptomEntry, SymptomDraft, TimeUnit, FieldError };

/* -------------------------------------------------------------------------- */
/* Symptom multi-tagging / associations (Requirements 16.1–16.5)              */
/* -------------------------------------------------------------------------- */

/**
 * The user-entered association input submitted for tagging a symptom.
 *
 * Field types are loose where a user could supply malformed values so the
 * tagging logic can reject and still surface the entered ids back in the
 * editing state (16.2, 16.5).
 */
export interface AssociationInput {
  /** The id of the symptom being tagged. */
  symptomId?: unknown;
  /** The condition ids the user wants to link (1–50 existing conditions, 16.1, 16.2). */
  conditionIds?: unknown;
  /** The medication ids to link when flagged as an adverse reaction (1–50, 16.3). */
  medicationIds?: unknown;
}

/**
 * Persistence abstraction over the decrypted `associations` partition record set.
 *
 * Concrete implementations bridge the Local_Vault + Crypto_Engine: read decrypts
 * the `associations` Vault_Blob into its records, and write serializes + encrypts
 * the updated record set back (16.4). Injecting this keeps the tagging engine
 * free of crypto/storage concerns and unit-testable under vitest.
 */
export interface AssociationStore {
  /** Read all decrypted association records currently in the `associations` partition. */
  readAssociations(): Promise<Association[]>;
  /** Persist the full decrypted association record set back to the `associations` partition. */
  writeAssociations(records: Association[]): Promise<void>;
}

/**
 * Existence lookups over the Local_Vault used to reject links to records that
 * do not exist (16.2). Implementations typically read the decrypted `conditions`
 * and `medications` partitions and return the set of known ids.
 */
export interface AssociationLookups {
  /** Returns the ids of all conditions that exist in the Local_Vault. */
  knownConditionIds(): Promise<Iterable<string>>;
  /** Returns the ids of all medications that exist in the Local_Vault. */
  knownMedicationIds(): Promise<Iterable<string>>;
}

/**
 * Injectable side-effect dependencies for the association tagger, defaulted in
 * {@link createSymptomAssociations}. Overriding these makes id/timestamp
 * generation deterministic in tests.
 */
export interface SymptomAssociationDeps {
  /** Generates a unique record id (UUID in production). */
  newId(): string;
  /** Returns the client-side operational timestamp as an ISO 8601 string. */
  now(): string;
}

/**
 * The editing state carried back to the caller. It mirrors the user's entered
 * ids so a rejected/failed tagging attempt can be re-rendered without data
 * loss (16.2, 16.5).
 */
export interface AssociationEditingState {
  symptomId: string;
  conditionIds: string[];
  medicationIds: string[];
}

/**
 * Result of attempting to save a symptom's associations.
 *
 * - On success the persisted {@link Association} (with `id` and `op_timestamp`)
 *   is returned (16.1, 16.3, 16.4).
 * - On rejection (validation or unknown-condition/medication link, 16.2) the
 *   per-field {@link FieldError}s plus the retained {@link AssociationEditingState}
 *   are returned so the user's other entered associations are not lost.
 * - On persistence failure (16.5) `failed: 'persistence'` is set, the editing
 *   state is retained, and the caller must block progression until a retry
 *   succeeds.
 */
export type SaveAssociationsResult =
  | { ok: true; association: Association }
  | {
      ok: false;
      failed: 'validation' | 'persistence';
      errors: FieldError[];
      editing: AssociationEditingState;
    };

export type { Association };

/* -------------------------------------------------------------------------- */
/* Batch flare-up logging (Requirements 17.1–17.5)                            */
/* -------------------------------------------------------------------------- */

/**
 * The user-entered flare-up input submitted for logging.
 *
 * Field types are loose where a user could supply malformed values so the
 * batch-logging logic can reject and still surface the entered selection back
 * in the editing state (17.4, 17.5).
 */
export interface FlareUpInput {
  /** The ids of the active symptoms batch-selected into the event (2–50, 17.1, 17.4). */
  symptomIds?: unknown;
  /** The suspected environmental or physiological trigger (≤500 chars, 17.2). */
  trigger?: unknown;
  /** Optional approximate GPS when logging (opt-in). */
  location?: LogLocation;
}

/**
 * Persistence abstraction over the decrypted `flares` partition record set.
 *
 * Concrete implementations bridge the Local_Vault + Crypto_Engine: read decrypts
 * the `flares` Vault_Blob into its records, and write serializes + encrypts the
 * updated record set back (17.3). Injecting this keeps the flare-logging engine
 * free of crypto/storage concerns and unit-testable under vitest.
 */
export interface FlareStore {
  /** Read all decrypted flare-up records currently in the `flares` partition. */
  readFlares(): Promise<FlareUp[]>;
  /** Persist the full decrypted flare-up record set back to the `flares` partition. */
  writeFlares(records: FlareUp[]): Promise<void>;
}

/**
 * Existence/active-state lookup over the Local_Vault used to restrict a flare's
 * batch selection to symptoms currently marked active in the Symptom_Journal
 * (17.1). Implementations typically read the decrypted `symptoms` partition and
 * return the ids of entries whose `active` flag is set.
 */
export interface FlareLookups {
  /** Returns the ids of all symptoms currently marked active in the Local_Vault. */
  activeSymptomIds(): Promise<Iterable<string>>;
}

/**
 * Injectable side-effect dependencies for the flare logger, defaulted in
 * {@link createFlareJournal}. Overriding these makes id/timestamp generation
 * deterministic in tests.
 */
export interface FlareJournalDeps {
  /** Generates a unique record id (UUID in production). */
  newId(): string;
  /** Returns the client-side operational timestamp as an ISO 8601 string. */
  now(): string;
}

/**
 * The editing state carried back to the caller. It mirrors the user's selected
 * (active) symptoms and trigger so a rejected/failed flare attempt can be
 * re-rendered without losing the selection (17.4, 17.5).
 */
export interface FlareEditingState {
  symptomIds: string[];
  trigger: string;
}

/**
 * Result of attempting to log a batch flare-up.
 *
 * - On success the persisted {@link FlareUp} (with `id` and `op_timestamp`) is
 *   returned, holding references to each selected symptom (17.1, 17.2, 17.3).
 * - On rejection (validation: fewer than 2 active symptoms, more than 50, a
 *   trigger over 500 chars, or a selection that includes non-active/unknown
 *   symptoms) the per-field {@link FieldError}s plus the retained
 *   {@link FlareEditingState} are returned so the selection is preserved (17.4).
 * - On persistence failure `failed: 'persistence'` is set, the data is retained
 *   in the editing state, and an error is surfaced (17.5).
 */
export type LogFlareResult =
  | { ok: true; flare: FlareUp }
  | {
      ok: false;
      failed: 'validation' | 'persistence';
      errors: FieldError[];
      editing: FlareEditingState;
    };

export type { FlareUp };
