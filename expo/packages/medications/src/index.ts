/**
 * @complex-patient/medications
 *
 * The Polypharmacy_Engine: medication-profile CRUD, scheduling, PRN safety, and
 * the adaptive view. This entry point currently exposes medication-profile CRUD
 * against the Local_Vault (Requirements 10.1–10.6, 11.5); later tasks add PRN
 * Quick Log (R13), the adaptive view (R14), and reminders (R12).
 */

export type {
  VaultCrypto,
  MedicationVaultStore,
  VaultBlobLike,
  IdFactory,
  Clock,
  MedicationProfileInput,
  MedicationProfileEdit,
  MedicationEngineErrorCode,
  CreateProfileResult,
  UpdateProfileResult,
} from './types';

export type { MedicationPartitionState, MedicationPartitionPayload } from './gateway';
export { readMedicationPartition, writeMedicationPartition } from './gateway';

export type { MedicationProfileEngineDeps } from './engine';
export { MedicationProfileEngine } from './engine';

export type {
  PrnQuickLogEngineDeps,
  PrnQuickLogOptions,
  PrnQuickLogResult,
  PrnQuickLogEvaluation,
  PrnQuickLogEvaluationInput,
} from './prn';
export {
  PrnQuickLogEngine,
  computeTrailing24hCumulative,
  evaluatePrnQuickLog,
} from './prn';

export type { PolyView, PolyViewBlock } from './view';
export { buildPolypharmacyView } from './view';

export type {
  ReminderPlatform,
  NotificationState,
  MedicationReminderEvent,
  LocalPushRequest,
  NotificationStateChecker,
  LocalPushTrigger,
  DashboardBadgeUpdater,
  ReminderAdapters,
  ReminderOutcome,
} from './reminders';
export {
  dispatchMedicationReminder,
  dispatchMedicationReminders,
} from './reminders';
