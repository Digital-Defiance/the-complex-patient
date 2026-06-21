/**
 * @complex-patient/symptom-journal — Symptom logging with draft retention
 *
 * Implements symptom entry logging for the Symptom_Journal subsystem:
 * - validate user input and, on success, store the symptom entry in the
 *   `symptoms` partition stamped with its client-side operational timestamp
 *   (Requirements 15.1, 15.2);
 * - on validation rejection, return the per-field errors together with a draft
 *   of the entered details so the captured information is not lost
 *   (Requirement 15.6).
 *
 * The engine operates on decrypted {@link SymptomEntry} records and persists
 * through an injected {@link SymptomStore}, keeping crypto/Local_Vault wiring
 * substitutable and the logic unit-testable.
 */

import { validateSymptomEntry } from '@complex-patient/domain';
import type {
  LogSymptomResult,
  SymptomDraft,
  SymptomEntry,
  SymptomEntryInput,
  SymptomJournalDeps,
  SymptomStore,
  TimeUnit,
} from './types';

const VALID_TIME_UNITS: readonly TimeUnit[] = ['minutes', 'hours', 'days', 'weeks'];

/**
 * Build a {@link SymptomDraft} from raw user input. Every field is captured
 * best-effort and untouched by validation so no entered information is lost on
 * rejection (Requirement 15.6). Values that cannot be represented in the draft
 * shape (e.g. a non-object duration) are simply omitted, but the user's other
 * fields are still retained.
 */
function toDraft(input: SymptomEntryInput): SymptomDraft {
  const draft: SymptomDraft = {};

  if (typeof input.symptomType === 'string') {
    draft.symptomType = input.symptomType;
  }
  if (typeof input.systemicLocation === 'string') {
    draft.systemicLocation = input.systemicLocation;
  }
  if (typeof input.severity === 'number') {
    draft.severity = input.severity;
  }
  if (typeof input.notes === 'string') {
    draft.notes = input.notes;
  }
  if (typeof input.active === 'boolean') {
    draft.active = input.active;
  }

  if (input.duration != null && typeof input.duration === 'object') {
    const dur = input.duration as { value?: unknown; unit?: unknown };
    const draftDuration: { value?: number; unit?: TimeUnit } = {};
    if (typeof dur.value === 'number') {
      draftDuration.value = dur.value;
    }
    if (typeof dur.unit === 'string' && VALID_TIME_UNITS.includes(dur.unit as TimeUnit)) {
      draftDuration.unit = dur.unit as TimeUnit;
    }
    if (draftDuration.value !== undefined || draftDuration.unit !== undefined) {
      draft.duration = draftDuration;
    }
  }

  return draft;
}

/**
 * The Symptom_Journal logging surface.
 */
export interface SymptomJournal {
  /**
   * Validate and log a symptom entry.
   *
   * On success the entry is stored in the `symptoms` partition with a freshly
   * generated id and the client-side operational timestamp, and the stored
   * record is returned (15.1, 15.2). On validation rejection nothing is
   * persisted and a draft of the entered details is returned alongside the
   * per-field errors (15.6).
   */
  logSymptom(input: SymptomEntryInput): Promise<LogSymptomResult>;
}

class SymptomJournalImpl implements SymptomJournal {
  private readonly store: SymptomStore;
  private readonly deps: SymptomJournalDeps;

  constructor(store: SymptomStore, deps: SymptomJournalDeps) {
    this.store = store;
    this.deps = deps;
  }

  async logSymptom(input: SymptomEntryInput): Promise<LogSymptomResult> {
    const result = validateSymptomEntry({
      symptomType: input.symptomType,
      systemicLocation: input.systemicLocation,
      severity: input.severity,
      duration: input.duration,
      notes: input.notes,
    });

    // Validation rejected → retain entered details as a draft (15.6).
    if (!result.valid) {
      return { ok: false, errors: result.errors, draft: toDraft(input) };
    }

    // Validated entry → stamp with id + op_timestamp and store (15.1, 15.2).
    const entry: SymptomEntry = {
      id: this.deps.newId(),
      op_timestamp: this.deps.now(),
      symptomType: (input.symptomType as string).trim(),
      systemicLocation: (input.systemicLocation as string).trim(),
      severity: input.severity as number,
      duration: {
        value: (input.duration as { value: number; unit: TimeUnit }).value,
        unit: (input.duration as { value: number; unit: TimeUnit }).unit,
      },
      notes: typeof input.notes === 'string' ? input.notes : '',
      active: typeof input.active === 'boolean' ? input.active : true,
      ...(input.location ? { location: input.location } : {}),
    };

    const existing = await this.store.readSymptoms();
    await this.store.writeSymptoms([...existing, entry]);

    return { ok: true, entry };
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
  return 'sym-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Construct a {@link SymptomJournal} over an injected {@link SymptomStore}.
 *
 * `deps` are optional; by default id generation uses `crypto.randomUUID` and the
 * operational timestamp is `new Date().toISOString()`. Tests override these for
 * deterministic assertions.
 */
export function createSymptomJournal(
  store: SymptomStore,
  deps: Partial<SymptomJournalDeps> = {},
): SymptomJournal {
  const resolved: SymptomJournalDeps = {
    newId: deps.newId ?? defaultNewId,
    now: deps.now ?? (() => new Date().toISOString()),
  };
  return new SymptomJournalImpl(store, resolved);
}
