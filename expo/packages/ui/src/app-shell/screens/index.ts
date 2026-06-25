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
  type PassphraseSubmitResult,
  type BiometricSubmitResult,
  type PassphraseScreenDeps,
  type UnlockScreenProps,
  BIOMETRIC_FUTURE_UNLOCK_HINT,
  BIOMETRIC_FAST_PATH_HINT,
} from './UnlockScreen';
export {
  createKdfMaterialStorage,
  type KdfMaterialStorage,
  type StoredKdfMaterial,
} from './kdf-material-storage';
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
export { ExportScreen, type ExportScreenProps } from './ExportScreen';
export { ImportScreen, type ImportScreenProps } from './ImportScreen';
export { SymptomJournalLogScreen, type SymptomJournalLogScreenProps } from './SymptomJournalLogScreen';
export { SymptomJournalHubScreen, type SymptomJournalHubScreenProps } from './SymptomJournalHubScreen';
export { SymptomJournalHistoryScreen, type SymptomJournalHistoryScreenProps } from './SymptomJournalHistoryScreen';
export { FlareScreen, type FlareScreenProps } from './FlareScreen';
export { MedicationsScreen, type MedicationsScreenProps } from './MedicationsScreen';
export { PrnQuickLogScreen, type PrnQuickLogScreenProps } from './PrnQuickLogScreen';
export { WeatherSettingsSection, type WeatherSettingsSectionProps } from './WeatherSettingsSection';
export { PaperBackupSection, type PaperBackupSectionProps } from './PaperBackupSection';
export { PaperBackupRecoveryPanel, type PaperBackupRecoveryPanelProps } from './PaperBackupRecoveryPanel';
export { PaperBackupTemplateView, type PaperBackupTemplateViewProps } from './PaperBackupTemplateView';
export { PaperBackupVerificationStep, type PaperBackupVerificationStepProps } from './PaperBackupVerificationStep';
export { PaperBackupQrScanner, type PaperBackupQrScannerProps } from './PaperBackupQrScanner';
export { VaultSettingsScreen, type VaultSettingsScreenProps } from './VaultSettingsScreen';
export { ChangePassphraseSection, type ChangePassphraseSectionProps } from './ChangePassphraseSection';
export { PasskeyUnlockSection } from './PasskeyUnlockSection';
export { MedicationsHubScreen, type MedicationsHubScreenProps } from './medications/MedicationsHubScreen';
export { MedicationsTodayScreen, type MedicationsTodayScreenProps } from './medications/MedicationsTodayScreen';
export { MedicationFormScreen, type MedicationFormScreenProps } from './medications/MedicationFormScreen';
export { MedicationAdherenceHistoryScreen, type MedicationAdherenceHistoryScreenProps } from './medications/MedicationAdherenceHistoryScreen';
