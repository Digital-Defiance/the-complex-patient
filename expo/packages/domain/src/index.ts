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
  MedicationProfile,
  PrnLog,
} from './medications';

export type {
  TimeUnit,
  Condition,
  SymptomEntry,
  SymptomDraft,
  Association,
  FlareUp,
} from './symptoms';

export type {
  ProfileFieldError,
  ProfileValidationResult,
  ScheduleValidationResult,
  PrnLimitValidationResult,
} from './validation/medications';

export {
  validateMedicationProfile,
  validateMedicationSchedule,
  validatePrnSafetyLimit,
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
