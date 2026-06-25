/**
 * @complex-patient/ui — Authenticated platform entry-point wiring (task 15.3)
 *
 * The shared composition root presented identically by the mobile (Expo Router)
 * and web (React Native Web) targets, plus the Sync_Backend authentication
 * credential model and the authenticated blind vault HTTP client (Requirements
 * 22.1, 22.2, 4.1).
 */

export type { WordPressAuth, AuthProvider, MutableAuthProvider } from './auth';
export {
  buildAuthorizationHeader,
  encodeBase64Utf8,
  createAuthProvider,
} from './auth';

export type {
  FetchLike,
  FetchLikeResponse,
  VaultHttpClientDeps,
  DevicePushRegistration,
  PaperBackupRecord,
  PaperBackupCreatePayload,
  PaperBackupListResponse,
  PaperBackupEnvelopeResponse,
} from './vault-http-client';
export { createVaultHttpClient, VAULT_HTTP_TRANSPORT_ERROR } from './vault-http-client';
export {
  DEVICE_ID_STORAGE_KEY,
  createDeviceIdStorage,
  getOrCreateDeviceId,
} from './device-id';
export type { DeviceIdStorage } from './device-id';
export { createSyncWorker } from './sync-worker';
export type { ActiveKekSource, CreateSyncWorkerDeps } from './sync-worker';

export type {
  HomeStatus,
  HomeUnlockResult,
  SignInResult,
  HomeEntryDeps,
  HomeEntryController,
  PaperBackupSummary,
  CreatePaperBackupResult,
  PaperBackupRecoveryResult,
  ChangePassphraseResult,
} from './home-entry';
export { createHomeEntry } from './home-entry';

export type {
  IneligibilityFlagStore,
  DeviceFlagStorage,
  OnboardingStatus,
  AgeSubmissionResult,
  AgeGateOnboardingDeps,
  AgeGateOnboardingController,
} from './age-gate-onboarding';
export {
  INELIGIBILITY_FLAG_KEY,
  INELIGIBILITY_FLAG_VALUE,
  createDeviceIneligibilityFlagStore,
  createAgeGateOnboarding,
} from './age-gate-onboarding';
