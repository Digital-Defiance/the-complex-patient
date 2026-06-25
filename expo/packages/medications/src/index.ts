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
export {
  buildPolypharmacyView,
  buildPolypharmacyView as buildMedicationsView,
} from './view';

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

export type { ScheduledDoseSlot } from './schedule';
export { expandDosesForDay, scheduledDoseKey, doseInstanceKey } from './schedule';

export type { TodayDoseStatus, TodayScheduledDose, TodayPrnRegimen, TodayQueue } from './today';
export { buildTodayQueue } from './today';

export type { MedEventMutationResult, AdherenceDaySummary } from './adherence';
export {
  recordDoseTaken,
  recordDoseSkipped,
  recordDoseSnoozed,
  summarizeAdherenceHistory,
} from './adherence';

export type { MedicationNotificationTrigger } from './notification-schedule';
export {
  buildMedicationNotificationTriggers,
  notificationTriggerId,
} from './notification-schedule';

export { makeMedicationProfile } from './test-fixtures';
