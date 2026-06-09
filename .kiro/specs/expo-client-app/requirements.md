# Requirements Document

## Introduction

This feature stands up the actual runnable universal Expo client (iOS, Android, and Web via React Native Web) for The Complex Patient platform. The prior `complex-patient-platform` spec delivered a complete set of headless, dependency-injected TypeScript logic packages and a WordPress PHP backend, all fully tested. What it did not deliver is a runnable application: there is no React/React Native UI layer, no Expo Router route tree, no valid `app.json`, and the Expo runtime dependencies are not installed. As a result, launching the development server currently fails because the `expo` module is not resolvable.

The objective of this feature is to build the UI / app-shell layer and the runtime/dependency setup so that `npx expo start` (run via Yarn) launches the app on all three targets. The work consumes the existing headless seams (the `@complex-patient/ui` controllers, the subsystem engines, and the `apps/mobile` / `apps/web` entry composition roots) without reimplementing them. The existing logic packages and WordPress backend are treated as fixed dependencies.

The feature MUST preserve the platform's zero-knowledge and offline-first guarantees established by the prior spec: no PHI, Master_Passphrase, or KEK leaves the device, and the UI reads from the Local_Vault and never blocks rendering on network availability.

The scope of this document is the application shell, navigation, screens, runtime dependency setup, and the wiring of cross-cutting UI behaviors (sync-status indication and auto-lock). It deliberately excludes the cryptographic logic, vault logic, sync logic, subsystem engine logic, and backend behavior, all of which are provided by existing dependencies.

## Glossary

- **Expo_Client_App**: The runnable universal application built by this feature, hosting the UI on top of the existing headless logic on iOS, Android, and Web.
- **App_Shell**: The root application composition and navigation host (Expo Router) that constructs the controllers once and renders screens based on controller state.
- **Mobile_App**: The Expo_Client_App running on iOS or Android, composed via `createMobileApp` / `createMobileHome`.
- **Web_App**: The Expo_Client_App running in a web browser via React Native Web, composed via `createWebApp` / `createWebHome`.
- **Workspace**: The Yarn monorepo rooted at `expo/` with workspaces `apps/mobile`, `apps/web`, and `packages/*`.
- **Package_Manager**: Yarn (with Plug'n'Play), the sole dependency manager for the Workspace; npm is not used.
- **App_Config**: The `app.json` Expo configuration file (name, slug, sdkVersion, platforms, and related fields).
- **Expo_Router**: The file-based navigation system used as the navigation host for the App_Shell.
- **Route_Tree**: The set of Expo_Router route files that map application states to screens.
- **Home_Controller**: The `HomeEntryController` from `@complex-patient/ui` (created via `createHomeEntry`, exposed through `createMobileHome` / `createWebHome`) with statuses `signed-out`, `locked`, and `ready`.
- **Onboarding_Controller**: The `AgeGateOnboardingController` from `@complex-patient/ui` (created via `createAgeGateOnboarding`) with statuses `checking`, `age-gate`, `ineligible`, and `eligible`.
- **Secure_Store_Adapter**: The `expo-secure-store`-backed `SecureStoreAdapter` injected into `createMobileApp`.
- **Biometric_Adapter**: The `expo-local-authentication`-backed `BiometricAdapter` injected into `createMobileApp`.
- **Notification_Adapter**: The `expo-notifications`-backed adapter injected for medication reminders.
- **Polypharmacy_Engine**: The existing `@complex-patient/polypharmacy` subsystem (medication profiles, PRN quick log, adaptive view).
- **Symptom_Journal**: The existing `@complex-patient/symptom-journal` subsystem (symptom logging, flare-ups, condition timeline).
- **Insights_Engine**: The existing `@complex-patient/insights` subsystem (insight cards, physician report).
- **Local_Vault**: The client-side encrypted database that is the source of truth for the UI (provided by the prior spec).
- **Sync_Backend**: The blind WordPress plugin backend (provided by the prior spec).
- **Sync_Status**: The connectivity and pending-write state surfaced by the Home_Controller's offline-sync coordinator.
- **Master_Passphrase**: The user-supplied secret from which the KEK is derived; never transmitted off-device.
- **KEK**: The Key Encryption Key held in the platform Session Key Store; never transmitted off-device.
- **PHI**: Protected Health Information entered by the user (medications, symptoms, conditions, journaling data).
- **Idle_Auto_Lock**: The 300-second inactivity timer that locks the vault, provided by the Home_Controller's lock binding.
- **Secure_Context**: A web runtime served over HTTPS where `window.crypto.subtle` is available.

## Requirements

### Requirement 1: Expo and React Native Runtime Dependencies

**User Story:** As a developer, I want the real Expo and React Native runtime dependencies declared and installed via Yarn, so that the development server can resolve the `expo` module and launch the app.

#### Acceptance Criteria

1. THE Workspace SHALL declare `expo`, `react`, `react-native`, `react-dom`, `react-native-web`, and `expo-router` as dependencies at exact versions (no range operators) corresponding to the single Expo SDK version declared in the App_Config.
2. THE Workspace SHALL declare `expo-secure-store`, `expo-local-authentication`, and `expo-notifications` as dependencies of the Mobile_App at exact versions corresponding to the declared Expo SDK version.
3. WHEN the Package_Manager install completes, THE Workspace SHALL resolve each declared runtime module without an unresolved-dependency error.
4. WHEN a developer runs `yarn expo start` from the Workspace root, THE Expo_Client_App SHALL resolve the `expo` module, reach a running development-server state, and print a reachable server URL without an "Expo SDK version cannot be determined" error.
5. IF a declared runtime dependency version is incompatible with the declared Expo SDK version, THEN THE Expo_Client_App SHALL report the incompatible dependency name and the expected version range AND SHALL prevent the development server from reaching a running state until the incompatibility is resolved.
6. THE Workspace SHALL preserve the existing Yarn Plug'n'Play configuration when adding runtime dependencies, keeping `nodeLinker` set to `pnp` and creating no `node_modules` directory at the Workspace root.

### Requirement 2: Application Configuration

**User Story:** As a developer, I want a valid `app.json`, so that Expo can identify the project, its SDK version, and its target platforms.

#### Acceptance Criteria

1. THE App_Config SHALL define a non-empty application `name` and a non-empty `slug`.
2. THE App_Config SHALL declare an Expo `sdkVersion` whose major version equals the major version of the installed `expo` package.
3. THE App_Config SHALL declare `ios`, `android`, and `web` as supported platforms.
4. THE App_Config SHALL declare `expo-router` as the navigation plugin.
5. THE App_Config SHALL preserve the existing EAS `projectId` value `03afbce3-092b-4382-ba04-8a0b4b34eef9`.
6. WHEN the development server reads the App_Config, THE Expo_Client_App SHALL load the configuration without a schema validation error.
7. IF the App_Config is missing a required field (`name`, `slug`, or `sdkVersion`), THEN THE Expo_Client_App SHALL report the missing field AND SHALL prevent the development server from reaching a running state.

### Requirement 3: Mobile Application Shell and Navigation

**User Story:** As a patient on iOS or Android, I want a navigable app shell, so that I can move between onboarding, authentication, and feature screens.

#### Acceptance Criteria

1. THE Mobile_App SHALL provide an Expo_Router Route_Tree with a root layout that constructs the application controllers exactly once per launch.
2. WHEN the Mobile_App launches, THE App_Shell SHALL compose the controllers by calling `createMobileApp` with the Secure_Store_Adapter, the Biometric_Adapter, the KEK codec, the HTTPS Sync_Backend base URL, and the ineligibility storage adapter.
3. THE App_Shell SHALL inject the `expo-secure-store` implementation as the Secure_Store_Adapter.
4. THE App_Shell SHALL inject the `expo-local-authentication` implementation as the Biometric_Adapter.
5. THE App_Shell SHALL inject the `expo-notifications` implementation as the Notification_Adapter for medication reminders.
6. WHILE the Onboarding_Controller status is `eligible`, WHEN the Home_Controller status changes, THE App_Shell SHALL navigate to the Route_Tree screen mapped to the new status: `signed-out` to the sign-in screen, `locked` to the unlock screen, and `ready` to the authenticated home screen.
7. IF the App_Shell attempts to construct the Home_Controller before the Onboarding_Controller reports `eligible`, THEN THE App_Shell SHALL surface a rejection indication, SHALL NOT construct a Local_Vault, and SHALL remain on the current screen.
8. IF `createMobileApp` controller composition fails, THEN THE App_Shell SHALL display a composition-failure message AND SHALL NOT render an onboarding or authenticated screen.

### Requirement 4: Web Application Shell over HTTPS

**User Story:** As a patient using a web browser, I want the web app served over HTTPS with React Native Web, so that the in-browser cryptography can run securely.

#### Acceptance Criteria

1. THE Web_App SHALL render through React Native Web using the same Route_Tree screens as the Mobile_App.
2. WHEN the Web_App launches, THE App_Shell SHALL evaluate whether the runtime is a Secure_Context (HTTPS transport with `window.crypto.subtle` available) before composing controllers, AND SHALL compose the controllers by calling `createWebApp` with the HTTPS Sync_Backend base URL and the `localStorage`-backed ineligibility storage adapter.
3. WHERE the Web_App runs in a Secure_Context, THE Web_App SHALL proceed to construct the Home_Controller.
4. IF the Web_App is loaded outside a Secure_Context, THEN THE Web_App SHALL display a message indicating that a secure (HTTPS) context is required, SHALL block all application functionality including Home_Controller construction and Local_Vault creation, AND SHALL leave no onboarding or authenticated screen rendered.
5. IF Home_Controller construction fails in a Secure_Context, THEN THE Web_App SHALL display a message indicating that construction failed, SHALL remain on the current screen without rendering the authenticated home screen, AND SHALL NOT create a Local_Vault.
6. WHEN a developer runs `yarn expo start --web`, THE Web_App SHALL serve the application bundle over a Secure_Context (HTTPS, or a `localhost` origin that the browser treats as a Secure_Context).

### Requirement 5: Age-Gate Onboarding Screen

**User Story:** As a prospective user, I want an age-eligibility screen as the first step, so that ineligible users are blocked before any vault is created.

#### Acceptance Criteria

1. WHEN the Expo_Client_App launches, THE App_Shell SHALL call `Onboarding_Controller.start` before rendering any onboarding step.
2. WHILE the Onboarding_Controller status is `checking`, THE App_Shell SHALL render a loading indicator AND SHALL NOT render the age-gate screen, the terminal ineligibility screen, or the Master_Passphrase setup screen.
3. IF `Onboarding_Controller.start` fails, THEN THE App_Shell SHALL display a message indicating that onboarding could not start AND SHALL NOT render the age-gate screen or construct a Local_Vault.
4. WHILE the Onboarding_Controller status is `age-gate`, THE App_Shell SHALL render the age-gate screen with a birth-month input that accepts integer values 1 through 12 and a birth-year input that accepts a four-digit calendar year.
5. WHEN the user submits the birth month and birth year, THE App_Shell SHALL route the input through `Onboarding_Controller.submitAge`.
6. IF `submitAge` returns `INVALID_AGE_INPUT`, THEN THE App_Shell SHALL display a re-prompt message AND SHALL remain on the age-gate screen.
7. WHEN `submitAge` returns eligible, THE App_Shell SHALL dismiss the age-gate screen AND SHALL navigate to the Master_Passphrase setup screen.
8. THE App_Shell SHALL display the re-prompt message only when `submitAge` returns `INVALID_AGE_INPUT`.
9. THE App_Shell SHALL exclude the submitted birth month and birth year from all persisted storage and all Sync_Backend requests.

### Requirement 6: Terminal Ineligibility Screen

**User Story:** As an ineligible user, I want a clear terminal screen, so that I understand I cannot proceed.

#### Acceptance Criteria

1. WHILE the Onboarding_Controller status is `ineligible`, THE App_Shell SHALL render the terminal ineligibility screen displaying a message indicating that the user is not eligible and cannot proceed.
2. THE terminal ineligibility screen SHALL omit any control that returns to the age-gate screen.
3. WHEN the Expo_Client_App launches and `Onboarding_Controller.start` reports `ineligible`, THE App_Shell SHALL render the terminal ineligibility screen without rendering the age-gate screen.
4. IF the terminal ineligibility screen fails to render, THEN THE App_Shell SHALL fall back to rendering the age-gate screen.

### Requirement 7: Master Passphrase Setup and Unlock Screen

**User Story:** As a patient, I want to set up and later unlock my vault with my Master_Passphrase, so that my encrypted data is accessible only to me.

#### Acceptance Criteria

1. WHILE the Home_Controller status is `signed-out`, THE App_Shell SHALL render the sign-in screen.
2. WHILE the Home_Controller status is `locked`, THE App_Shell SHALL render the unlock screen.
3. WHEN the user submits a Master_Passphrase on the setup path (first vault creation), THE App_Shell SHALL derive the KEK through the existing Crypto_Engine and SHALL pass the resulting key reference to `Home_Controller.unlockWithKek`.
4. WHEN the user requests a biometric unlock on the Mobile_App, THE App_Shell SHALL invoke `Home_Controller.unlock`.
5. IF an unlock attempt returns `BIOMETRIC_FAILED` or `BIOMETRIC_LOCKED_OUT`, THEN THE App_Shell SHALL present the Master_Passphrase re-entry path AND SHALL remain on the unlock screen.
6. WHEN `Home_Controller.unlockWithKek` or `Home_Controller.unlock` returns `ready`, THE App_Shell SHALL navigate to the authenticated home screen.
7. THE App_Shell SHALL exclude the Master_Passphrase and the derived KEK from all Sync_Backend requests.
8. IF the user submits a Master_Passphrase outside the 8-to-128-character length bound, THEN THE App_Shell SHALL display a passphrase-length message AND SHALL NOT derive a KEK.
9. IF `Home_Controller.unlockWithKek` or `Home_Controller.unlock` returns a non-`ready` result other than `BIOMETRIC_FAILED` or `BIOMETRIC_LOCKED_OUT`, THEN THE App_Shell SHALL preserve the locked state AND SHALL remain on the unlock screen.

### Requirement 8: Authenticated Home Screen

**User Story:** As a patient, I want an authenticated home screen, so that I can reach each feature subsystem.

#### Acceptance Criteria

1. WHILE the Home_Controller status is `ready`, THE App_Shell SHALL render the authenticated home screen.
2. WHILE the Home_Controller status is `signed-out`, THE App_Shell SHALL render the sign-in screen instead of the authenticated home screen.
3. WHILE the Home_Controller status is `locked`, THE App_Shell SHALL render the unlock screen instead of the authenticated home screen.
4. THE authenticated home screen SHALL present navigation entries for the Polypharmacy_Engine, the Symptom_Journal, and the Insights_Engine subsystems.
5. WHEN the user selects sign-out, THE App_Shell SHALL call `Home_Controller.signOut` and SHALL navigate to the sign-in screen.
6. THE authenticated home screen SHALL read displayed data exclusively through `Home_Controller.read`.
7. WHEN the user selects a subsystem navigation entry, THE App_Shell SHALL navigate to that subsystem's screen.
8. IF `Home_Controller.read` fails, THEN THE App_Shell SHALL display a data-unavailable message AND SHALL NOT render stale or partial PHI.

### Requirement 9: Polypharmacy Screens

**User Story:** As a patient managing many medications, I want medication and PRN screens, so that I can view my regimen and log as-needed doses.

#### Acceptance Criteria

1. WHEN the user opens the medication list and `buildPolypharmacyView` returns one or more medication profiles, THE App_Shell SHALL render those medication profiles.
2. THE App_Shell SHALL render the adaptive view blocks in the exact order provided by `buildPolypharmacyView`, with no block omitted, reordered, or inserted.
3. WHEN the user opens the medication list and `buildPolypharmacyView` returns zero medication profiles, THE App_Shell SHALL display an empty-medication-list message and SHALL render no medication profile rows.
4. WHEN the user submits a PRN quick-log entry, THE App_Shell SHALL route the entry through the Polypharmacy_Engine PRN quick-log path and SHALL NOT mutate the medication regimen through any other path.
5. IF the PRN quick-log evaluation reports a safety threshold result, THEN THE App_Shell SHALL display the evaluation outcome, including whether a safety threshold was exceeded, before accepting another PRN quick-log entry.
6. THE App_Shell SHALL persist medication and PRN changes exclusively through `Home_Controller.commit` and SHALL NOT persist them through any other mechanism.
7. IF a `Home_Controller.commit` of a medication or PRN change fails, THEN THE App_Shell SHALL display a persistence-failure message indicating the change was not saved and SHALL retain the user's entered values.

### Requirement 10: Symptom Journal Screens

**User Story:** As a patient tracking symptoms, I want logging, flare-up, and timeline screens, so that I can record and review my condition history.

#### Acceptance Criteria

1. WHEN the user submits a symptom entry, THE App_Shell SHALL route the entry through the Symptom_Journal logging path and SHALL NOT record the entry through any other path.
2. WHEN the user submits a flare-up, THE App_Shell SHALL route the flare-up through the Symptom_Journal flare path and SHALL NOT record the flare-up through any other path.
3. WHEN the user opens a condition timeline, THE App_Shell SHALL render the timeline entries produced by `buildConditionTimeline` ordered by entry timestamp from oldest to newest.
4. WHEN the user opens a condition timeline and `buildConditionTimeline` returns zero entries, THE App_Shell SHALL display an empty-timeline message and SHALL render no timeline entries.
5. IF a Symptom_Journal submission returns a field error, THEN THE App_Shell SHALL display the returned field error and SHALL retain all values the user entered in that submission.
6. WHEN a Symptom_Journal submission succeeds, THE App_Shell SHALL clear the displayed field error.
7. THE App_Shell SHALL persist symptom and flare-up changes exclusively through `Home_Controller.commit` and SHALL NOT persist them through any other mechanism.
8. IF a `Home_Controller.commit` of a symptom or flare-up change fails, THEN THE App_Shell SHALL display a persistence-failure message indicating the change was not saved and SHALL retain the user's entered values.

### Requirement 11: Insights Screens

**User Story:** As a patient, I want insight cards and a physician report, so that I can understand correlations and share a summary with my clinician.

#### Acceptance Criteria

1. WHEN the user opens the insights screen, THE App_Shell SHALL render the AI insight cards produced by the Insights_Engine correlation detection.
2. IF the Insights_Engine reports insufficient history, THEN THE App_Shell SHALL display the insufficient-history message and SHALL render no insight cards.
3. WHEN the user opens the insights screen and the Insights_Engine returns zero insight cards without reporting insufficient history, THE App_Shell SHALL display a no-correlations-found message.
4. WHEN the user requests a physician report, THE App_Shell SHALL generate the report through the Insights_Engine report path on-device and SHALL NOT transmit report-source PHI to the Sync_Backend during generation.
5. IF physician report generation through the Insights_Engine report path fails, THEN THE App_Shell SHALL display a report-generation-failure message and SHALL remain on the insights screen.
6. THE App_Shell SHALL compute insight cards and physician reports using only data read through the `Home_Controller.read` path.
7. IF the Home_Controller data source is unavailable, THEN THE App_Shell SHALL block insights functionality and SHALL display a data-unavailable message.

### Requirement 12: Offline-First Sync Status Indication

**User Story:** As a patient, I want a sync-status indicator, so that I know whether my data is synced or pending while offline.

#### Acceptance Criteria

1. THE App_Shell SHALL render a Sync_Status indicator that displays a visually distinct state for each Home_Controller offline-sync coordinator state value (idle, syncing, pending, and conflict) AND SHALL update the displayed state within 1 second of a coordinator state change.
2. WHILE the offline-sync coordinator state is `pending` or `syncing`, THE App_Shell SHALL display a non-idle in-progress state in the Sync_Status indicator.
3. IF the offline-sync coordinator state is `conflict`, THEN THE App_Shell SHALL display a conflict state in the Sync_Status indicator that is visually distinct from the idle, syncing, and pending states.
4. WHEN connectivity is restored, THE App_Shell SHALL call `Home_Controller.onConnectivityRestored` within 5 seconds of detecting restored connectivity.
5. WHILE the Sync_Backend is unreachable, THE App_Shell SHALL render data read from the Local_Vault within 1 second without issuing a blocking network request.
6. WHEN the user reads or writes data, THE App_Shell SHALL complete the read or write through the Home_Controller within 1 second regardless of Sync_Backend reachability and without waiting for a Sync_Backend response.

### Requirement 13: Idle Auto-Lock and Lock-on-Background

**User Story:** As a patient, I want the app to lock after inactivity or when backgrounded, so that my PHI is protected when I step away.

#### Acceptance Criteria

1. WHEN the user generates a touch, pointer, keyboard, or navigation interaction within the Expo_Client_App, THE App_Shell SHALL call `Home_Controller.notifyActivity` to reset the Idle_Auto_Lock 300-second countdown.
2. WHEN the Idle_Auto_Lock 300-second countdown elapses without user interaction, THE App_Shell SHALL lock the vault through the Home_Controller lock binding AND SHALL navigate to the unlock screen.
3. WHEN the Mobile_App enters the background, THE App_Shell SHALL lock the vault through the Home_Controller lock binding within 1 second of the background transition.
4. WHEN the Web_App tab is closed or reloaded, THE App_Shell SHALL allow the Web Session Key Store to discard the KEK.
5. WHEN the vault locks, THE App_Shell SHALL clear all rendered PHI from the screen within 1 second of the lock such that no PHI remains visible.
6. IF locking the vault through the Home_Controller lock binding fails, THEN THE App_Shell SHALL clear all rendered PHI from the screen AND SHALL navigate to the unlock screen.

### Requirement 14: Zero-Knowledge and Offline-First Preservation

**User Story:** As a patient, I want the runnable app to keep the platform's privacy and offline guarantees, so that adding the UI does not weaken security.

#### Acceptance Criteria

1. THE Expo_Client_App SHALL read and write all PHI exclusively through the Home_Controller and the existing subsystem engines.
2. THE Expo_Client_App SHALL exclude the Master_Passphrase, the KEK, and plaintext PHI from all Sync_Backend requests.
3. THE Expo_Client_App SHALL persist the age-gate ineligibility flag outside the Local_Vault using the injected device storage adapter.
4. WHEN the Sync_Backend is unreachable, THE Expo_Client_App SHALL continue to render and accept user input using the Local_Vault within 1 second and without issuing a blocking network request.
5. WHILE the Sync_Backend is unreachable, THE Expo_Client_App SHALL disable controls whose action requires a Sync_Backend response while continuing to provide all Local_Vault-backed read, write, and navigation functionality.
6. THE Expo_Client_App SHALL perform all cryptographic operations through the existing Crypto_Engine on the device.
