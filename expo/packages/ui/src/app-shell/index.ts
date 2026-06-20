/**
 * @complex-patient/ui — app-shell module
 *
 * The platform-agnostic UI shell shared identically by the mobile (Expo Router)
 * and web (React Native Web) targets. Starts with the pure navigation resolver
 * and shared route/state types (task 2.1); subsequent tasks add the app host,
 * screens, and platform wiring here.
 */

export type { AppRoute, NavState } from './navigation';
export { resolveRoute } from './navigation';

export { useStore, usePartition, useSyncStatus } from './hooks';

export type { AppHost, AppHostFactory, AppHostProviderProps } from './app-host';
export { useAppHost, AppHostProvider } from './app-host';

export { useConnectivity, ConnectivityProvider } from './connectivity-context';
export type { ConnectivityState, ConnectivityProviderProps } from './connectivity-context';

export type { ActivityResponderProps } from './activity-wiring';
export { ActivityResponder } from './activity-wiring';

export { SecureContextRequiredScreen, CompositionFailedScreen, LoadingScreen, AgeGateScreen, SignInScreen, IneligibleScreen, IneligibleScreenContent, IneligibleErrorBoundary, UnlockScreen, submitPassphrase, submitBiometric, createKdfMaterialStorage, HomeScreen, ConditionTimelineScreen, MedicationsScreen, PrnQuickLogScreen, SymptomJournalLogScreen, SymptomJournalHubScreen, SymptomJournalHistoryScreen, FlareScreen, InsightsScreen, PhysicianReportScreen, ExportScreen, ImportScreen, SyncStatusIndicator, useConnectivityWatcher, aggregateSyncStatus, STATUS_VISUALS } from './screens';
export type { KdfMaterialStorage, StoredKdfMaterial, PassphraseSubmitResult, BiometricSubmitResult, PassphraseScreenDeps, UnlockScreenProps, HomeScreenProps, ConditionTimelineScreenProps, MedicationsScreenProps, PrnQuickLogScreenProps, SymptomJournalLogScreenProps, SymptomJournalHubScreenProps, SymptomJournalHistoryScreenProps, FlareScreenProps, InsightsScreenProps, PhysicianReportScreenProps, ExportScreenProps, ImportScreenProps, SyncStatusIndicatorProps } from './screens';
