/**
 * @complex-patient/symptom-journal — Batch flare-up logging
 *
 * Implements unified flare-up event logging for the Symptom_Journal subsystem:
 * - batch-select between 2 and 50 symptoms that are currently marked *active*
 *   into a single unified event (Requirements 17.1, 17.4);
 * - record one suspected environmental or physiological trigger of up to 500
 *   characters for the event (17.2);
 * - store the event with references to each selected symptom in the `flares`
 *   partition through the injected store (within 2s — delegated to the
 *   Crypto_Engine / Local_Vault bridge) (17.3);
 * - reject a flare with fewer than 2 symptoms while preserving the user's
 *   selection in the editing state (17.4);
 * - on storage failure, retain the entered data in the editing state and
 *   surface an error (17.5).
 *
 * The engine operates on decrypted {@link FlareUp} records and persists through
 * an injected {@link FlareStore}, keeping crypto/Local_Vault wiring
 * substitutable and the logic unit-testable.
 */

import { validateFlareUp } from '@complex-patient/domain';
import type {
  FieldError,
  FlareEditingState,
  FlareJournalDeps,
  FlareLookups,
  FlareStore,
  FlareUp,
  FlareUpInput,
  LogFlareResult,
} from './types';

/**
 * Coerce a raw user value into a de-duplicated array of non-empty string ids.
 * Non-array input yields an empty array; non-string / blank entries are dropped.
 * Order of first appearance is preserved so the editing state mirrors the user's
 * selection order.
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
 * The Symptom_Journal batch flare-up logging surface.
 */
export interface FlareJournal {
  /**
   * Validate and log a batch flare-up.
   *
   * On success a single {@link FlareUp} record is persisted to the `flares`
   * partition with a freshly generated id and the client-side operational
   * timestamp, holding references to each batch-selected active symptom (17.1,
   * 17.2, 17.3), and the stored record is returned.
   *
   * On rejection nothing is persisted: a selection of fewer than 2 active
   * symptoms, more than 50 symptoms, a trigger over 500 chars, or a selection
   * that references symptoms not currently active are returned as per-field
   * errors, and the editing state retains the user's valid (active) selection
   * so it is not lost (17.4).
   *
   * On persistence failure the entered data is retained in the editing state
   * with a "not saved" error and `failed: 'persistence'` (17.5).
   */
  logFlare(input: FlareUpInput): Promise<LogFlareResult>;
}

class FlareJournalImpl implements FlareJournal {
  private readonly store: FlareStore;
  private readonly lookups: FlareLookups;
  private readonly deps: FlareJournalDeps;

  constructor(store: FlareStore, lookups: FlareLookups, deps: FlareJournalDeps) {
    this.store = store;
    this.lookups = lookups;
    this.deps = deps;
  }

  async logFlare(input: FlareUpInput): Promise<LogFlareResult> {
    const enteredSymptomIds = toStringIdArray(input.symptomIds);
    const trigger = typeof input.trigger === 'string' ? input.trigger : '';

    // Restrict the batch selection to symptoms currently marked active (17.1).
    const activeSymptomIds = new Set<string>(await this.lookups.activeSymptomIds());
    const selectedActiveIds = enteredSymptomIds.filter((id) => activeSymptomIds.has(id));
    const inactiveOrUnknownIds = enteredSymptomIds.filter((id) => !activeSymptomIds.has(id));

    // Editing state preserves the user's valid (active) selection and trigger so
    // a rejected/failed attempt can be re-rendered without data loss (17.4, 17.5).
    const editing: FlareEditingState = {
      symptomIds: selectedActiveIds,
      trigger,
    };

    const errors: FieldError[] = [];

    // Cardinality (2–50) and trigger length (≤500) are validated against the
    // active selection (17.1, 17.2, 17.4).
    const validation = validateFlareUp({
      symptomIds: selectedActiveIds,
      trigger,
    });
    if (!validation.valid) {
      errors.push(...validation.errors);
    }

    // Reject selections that reference symptoms that are not currently active
    // (or do not exist), identifying each while the active selection is retained.
    for (const id of inactiveOrUnknownIds) {
      errors.push({ field: 'symptomIds', message: `Symptom is not active: ${id}` });
    }

    if (errors.length > 0) {
      return { ok: false, failed: 'validation', errors, editing };
    }

    // All selections valid → build the flare-up record with references to each
    // selected symptom (17.1, 17.2, 17.3).
    const flare: FlareUp = {
      id: this.deps.newId(),
      op_timestamp: this.deps.now(),
      symptomIds: selectedActiveIds,
      trigger,
    };

    // Persist encrypted to the `flares` partition (17.3). On failure, retain the
    // entered data in the editing state and surface an error (17.5).
    try {
      const existing = await this.store.readFlares();
      await this.store.writeFlares([...existing, flare]);
    } catch {
      return {
        ok: false,
        failed: 'persistence',
        errors: [
          {
            field: 'flare',
            message: 'Flare-up was not saved. Please retry before continuing.',
          },
        ],
        editing,
      };
    }

    return { ok: true, flare };
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
  return 'flare-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Construct a {@link FlareJournal} logger over an injected {@link FlareStore}
 * and active-symptom {@link FlareLookups}.
 *
 * `deps` are optional; by default id generation uses `crypto.randomUUID` and the
 * operational timestamp is `new Date().toISOString()`. Tests override these for
 * deterministic assertions.
 */
export function createFlareJournal(
  store: FlareStore,
  lookups: FlareLookups,
  deps: Partial<FlareJournalDeps> = {},
): FlareJournal {
  const resolved: FlareJournalDeps = {
    newId: deps.newId ?? defaultNewId,
    now: deps.now ?? (() => new Date().toISOString()),
  };
  return new FlareJournalImpl(store, lookups, resolved);
}
