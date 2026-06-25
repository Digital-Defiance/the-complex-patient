/**
 * @complex-patient/domain
 *
 * Logical data models and validation for medications, symptoms, conditions, and flares.
 */

export type { VaultType, VaultRecord, PartitionPayload } from './types';

export type {
  Weekday,
  TimeBlock,
  TaperPhase,
  PrnConfig,
  MedicationSchedule,
  DoseRegimen,
  MedicationProfile,
  MedPillShape,
  MedAppearance,
  MedRefillTracking,
  MedEventStatus,
  MedEvent,
  LogLocation,
  PrnLog,
} from './medications';

export {
  summarizeMedicationDosage,
  summarizeMedicationForm,
  scheduledTimesForMedication,
  medicationHasPrn,
} from './medications';

export type {
  TimeUnit,
  Condition,
  SymptomEntry,
  SymptomDraft,
  Association,
  FlareUp,
} from './symptoms';

export type { LocationTrailSample } from './location-trail';

export type {
  ProfileFieldError,
  ProfileValidationResult,
  ScheduleValidationResult,
  PrnLimitValidationResult,
} from './validation/medications';

export {
  validateMedicationProfile,
  validateDoseRegimen,
  validateMedicationSchedule,
  validatePrnSafetyLimit,
  validatePrnConfig,
} from './validation/medications';

export type {
  FieldError,
  SymptomValidationResult,
  AssociationValidationResult,
  FlareValidationResult,
} from './validation/symptoms';

export {
  validateSymptomEntry,
  validateAssociation,
  validateFlareUp,
} from './validation/symptoms';

export type { AgeGateInput, AgeGateResult } from './age-gate';

export { evaluateAgeGate, MINIMUM_AGE_YEARS } from './age-gate';

export { makeTestMedicationProfile } from './test-fixtures';
