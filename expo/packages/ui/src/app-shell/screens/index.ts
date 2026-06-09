/**
 * @complex-patient/ui — Shared screen components
 *
 * These screens are consumed by both the mobile and web route files. They
 * contain no platform-specific code and render through React Native / React
 * Native Web.
 */

export { SecureContextRequiredScreen } from './SecureContextRequiredScreen';
export { CompositionFailedScreen } from './CompositionFailedScreen';
export { LoadingScreen } from './LoadingScreen';
export { AgeGateScreen } from './AgeGateScreen';
export { IneligibleScreen, IneligibleScreenContent, IneligibleErrorBoundary } from './IneligibleScreen';
export { SignInScreen } from './SignInScreen';
export {
  UnlockScreen,
  submitPassphrase,
  submitBiometric,
  createKdfMaterialStorage,
  type KdfMaterialStorage,
  type StoredKdfMaterial,
  type PassphraseSubmitResult,
  type BiometricSubmitResult,
  type PassphraseScreenDeps,
  type UnlockScreenProps,
} from './UnlockScreen';
export { HomeScreen, type HomeScreenProps } from './HomeScreen';
export { ConditionTimelineScreen, type ConditionTimelineScreenProps } from './ConditionTimelineScreen';
export {
  SyncStatusIndicator,
  useConnectivityWatcher,
  aggregateSyncStatus,
  STATUS_VISUALS,
  type SyncStatusIndicatorProps,
} from './SyncStatusIndicator';
export { InsightsScreen, type InsightsScreenProps } from './InsightsScreen';
export { PhysicianReportScreen, type PhysicianReportScreenProps } from './PhysicianReportScreen';
export { SymptomJournalLogScreen, type SymptomJournalLogScreenProps } from './SymptomJournalLogScreen';
export { FlareScreen, type FlareScreenProps } from './FlareScreen';
export { PolypharmacyScreen, type PolypharmacyScreenProps } from './PolypharmacyScreen';
export { PrnQuickLogScreen, type PrnQuickLogScreenProps } from './PrnQuickLogScreen';
