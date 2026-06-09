/**
 * @complex-patient/symptom-journal — Symptom multi-tagging (associations)
 *
 * Implements symptom-to-Condition and symptom-to-medication tagging for the
 * Symptom_Journal subsystem:
 * - link a symptom to between 1 and 50 existing Conditions (Requirement 16.1)
 *   and, when flagged as a suspected adverse reaction, 1–50 medications (16.3);
 * - reject a link to a Condition (or medication) that does not exist in the
 *   Local_Vault, surfacing a not-found error, while retaining the user's other
 *   entered associations (16.2);
 * - persist all associations to the `associations` partition in encrypted form
 *   through the injected store (within 2s — delegated to the Crypto_Engine /
 *   Local_Vault bridge) (16.4);
 * - on persistence failure, retain the unsaved associations in the editing
 *   state, surface a "not saved" error, and require the caller to block
 *   progression until a retry succeeds (16.5).
 *
 * The engine operates on decrypted {@link Association} records and persists
 * through an injected {@link AssociationStore}, keeping crypto/Local_Vault
 * wiring substitutable and the logic unit-testable.
 */

import { validateAssociation } from '@complex-patient/domain';
import type {
  Association,
  AssociationEditingState,
  AssociationInput,
  AssociationLookups,
  AssociationStore,
  FieldError,
  SaveAssociationsResult,
  SymptomAssociationDeps,
} from './types';

/**
 * Coerce a raw user value into a de-duplicated array of non-empty string ids.
 * Non-array input yields an empty array; non-string / blank entries are dropped.
 * Order of first appearance is preserved so the editing state mirrors the user's
 * entry order.
 */
function toStringIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed !== '' && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}

/**
 * The Symptom_Journal multi-tagging surface.
 */
export interface SymptomAssociations {
  /**
   * Validate and save a symptom's condition/medication associations.
   *
   * On success a single {@link Association} record is persisted to the
   * `associations` partition with a freshly generated id and the client-side
   * operational timestamp, and the stored record is returned (16.1, 16.3, 16.4).
   *
   * On rejection nothing is persisted: cardinality violations (16.1, 16.3) and
   * links to conditions/medications that do not exist in the Local_Vault (16.2)
   * are returned as per-field errors, and the editing state retains the user's
   * other valid associations so they are not lost.
   *
   * On persistence failure the unsaved (valid) associations are retained in the
   * editing state with a "not saved" error and `failed: 'persistence'`; the
   * caller MUST block progression until a retry succeeds (16.5).
   */
  saveAssociations(input: AssociationInput): Promise<SaveAssociationsResult>;
}

class SymptomAssociationsImpl implements SymptomAssociations {
  private readonly store: AssociationStore;
  private readonly lookups: AssociationLookups;
  private readonly deps: SymptomAssociationDeps;

  constructor(store: AssociationStore, lookups: AssociationLookups, deps: SymptomAssociationDeps) {
    this.store = store;
    this.lookups = lookups;
    this.deps = deps;
  }

  async saveAssociations(input: AssociationInput): Promise<SaveAssociationsResult> {
    const symptomId = typeof input.symptomId === 'string' ? input.symptomId.trim() : '';
    const enteredConditionIds = toStringIdArray(input.conditionIds);
    const enteredMedicationIds = toStringIdArray(input.medicationIds);

    // Resolve the set of ids that actually exist in the Local_Vault (16.2).
    const knownConditionIds = new Set<string>(await this.lookups.knownConditionIds());
    const knownMedicationIds = new Set<string>(await this.lookups.knownMedicationIds());

    const validConditionIds = enteredConditionIds.filter((id) => knownConditionIds.has(id));
    const validMedicationIds = enteredMedicationIds.filter((id) => knownMedicationIds.has(id));
    const unknownConditionIds = enteredConditionIds.filter((id) => !knownConditionIds.has(id));
    const unknownMedicationIds = enteredMedicationIds.filter((id) => !knownMedicationIds.has(id));

    // Editing state retains the user's *other* valid associations; the rejected
    // (unknown) links are dropped so the user can correct them (16.2, 16.5).
    const editing: AssociationEditingState = {
      symptomId,
      conditionIds: validConditionIds,
      medicationIds: validMedicationIds,
    };

    const errors: FieldError[] = [];

    // A symptom is required to anchor the associations.
    if (symptomId === '') {
      errors.push({ field: 'symptomId', message: 'A symptom is required to tag associations' });
    }

    // Cardinality: 1–50 conditions and ≤50 medications, evaluated on the
    // user's entered ids (16.1, 16.3).
    const cardinality = validateAssociation({
      conditionIds: enteredConditionIds,
      medicationIds: enteredMedicationIds,
    });
    if (!cardinality.valid) {
      errors.push(...cardinality.errors);
    }

    // Reject links to records that do not exist in the Local_Vault (16.2),
    // identifying each offending id while the valid links remain in `editing`.
    for (const id of unknownConditionIds) {
      errors.push({ field: 'conditionIds', message: `Condition not found: ${id}` });
    }
    for (const id of unknownMedicationIds) {
      errors.push({ field: 'medicationIds', message: `Medication not found: ${id}` });
    }

    if (errors.length > 0) {
      return { ok: false, failed: 'validation', errors, editing };
    }

    // All links valid → build the association record (16.1, 16.3).
    const association: Association = {
      id: this.deps.newId(),
      op_timestamp: this.deps.now(),
      symptomId,
      conditionIds: validConditionIds,
      medicationIds: validMedicationIds,
    };

    // Persist encrypted to the `associations` partition (16.4). On failure,
    // retain the unsaved associations in the editing state and signal that the
    // caller must block progression until a retry succeeds (16.5).
    try {
      const existing = await this.store.readAssociations();
      await this.store.writeAssociations([...existing, association]);
    } catch {
      return {
        ok: false,
        failed: 'persistence',
        errors: [
          {
            field: 'associations',
            message: 'Associations were not saved. Please retry before continuing.',
          },
        ],
        editing,
      };
    }

    return { ok: true, association };
  }
}

/**
 * Default UUID generator. Uses the platform `crypto.randomUUID` when available
 * (Node ≥ 16.7 / browsers / Expo), falling back to a RFC-4122-ish random id.
 */
function defaultNewId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Fallback: not cryptographically strong, only used where randomUUID is absent.
  return 'assoc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Construct a {@link SymptomAssociations} tagger over an injected
 * {@link AssociationStore} and existence {@link AssociationLookups}.
 *
 * `deps` are optional; by default id generation uses `crypto.randomUUID` and the
 * operational timestamp is `new Date().toISOString()`. Tests override these for
 * deterministic assertions.
 */
export function createSymptomAssociations(
  store: AssociationStore,
  lookups: AssociationLookups,
  deps: Partial<SymptomAssociationDeps> = {},
): SymptomAssociations {
  const resolved: SymptomAssociationDeps = {
    newId: deps.newId ?? defaultNewId,
    now: deps.now ?? (() => new Date().toISOString()),
  };
  return new SymptomAssociationsImpl(store, lookups, resolved);
}
