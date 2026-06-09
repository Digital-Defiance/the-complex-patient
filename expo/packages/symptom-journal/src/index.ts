/**
 * @complex-patient/symptom-journal
 *
 * The Symptom_Journal subsystem: symptom logging + drafts (R15). Operates on
 * decrypted symptom records and persists through an injected store so the
 * Local_Vault/Crypto_Engine wiring stays substitutable.
 */

export type {
  SymptomEntryInput,
  SymptomStore,
  SymptomJournalDeps,
  LogSymptomResult,
  SymptomEntry,
  SymptomDraft,
  TimeUnit,
  FieldError,
  AssociationInput,
  AssociationStore,
  AssociationLookups,
  SymptomAssociationDeps,
  AssociationEditingState,
  SaveAssociationsResult,
  Association,
  FlareUpInput,
  FlareStore,
  FlareLookups,
  FlareJournalDeps,
  FlareEditingState,
  LogFlareResult,
  FlareUp,
} from './types';

export type { SymptomJournal } from './journal';
export { createSymptomJournal } from './journal';

export type { SymptomAssociations } from './associations';
export { createSymptomAssociations } from './associations';

export type { FlareJournal } from './flares';
export { createFlareJournal } from './flares';

export type {
  TimelineEntryKind,
  TimelineEntry,
  ConditionTimeline,
  Condition,
} from './timeline';
export { buildConditionTimeline } from './timeline';
