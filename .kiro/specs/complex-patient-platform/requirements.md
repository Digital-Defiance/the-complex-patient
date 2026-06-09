# Requirements Document

## Introduction

The Complex Patient is an offline-first, privacy-focused, zero-knowledge end-to-end encrypted digital health platform for individuals managing complex medical profiles, multi-system chronic illnesses, and heavy polypharmacy. The platform is delivered as a monorepo containing a universal Expo client (iOS, Android, Web via React Native Web) and a custom WordPress plugin that acts as a structurally "blind" sync engine backend backed by shared MySQL.

The defining architectural guarantee is zero-knowledge: all cryptographic operations execute strictly client-side, and the server never receives, processes, or stores plaintext Protected Health Information (PHI), passphrases, or encryption keys. The client's local encrypted database is the source of truth, and a background sync worker reconciles local state with the server using encrypted opaque blobs and optimistic concurrency control.

The platform provides four functional pillars: (1) zero-knowledge cryptography with unified sync, (2) an advanced polypharmacy engine for complex medication scheduling and safety, (3) multi-system symptom and flare journaling, and (4) privacy-preserving on-device analytics that surface temporal correlations without transmitting raw data off-device.

## Glossary

- **Platform**: The complete Complex Patient system, comprising the Client and the Sync_Backend.
- **Client**: The universal Expo application running on iOS, Android, or a web browser via React Native Web.
- **Native_Client**: The Client running on iOS or Android.
- **Web_Client**: The Client running in a web browser.
- **Sync_Backend**: The custom WordPress plugin and its MySQL storage that act as a blind encrypted object store.
- **Crypto_Engine**: The shared client-side cryptographic module (`packages/crypto-engine`) responsible for key derivation, encryption, and decryption.
- **Sync_Worker**: The background client-side process that reconciles the Local_Vault with the Sync_Backend.
- **Local_Vault**: The client-side encrypted database (expo-sqlite or encrypted MMKV) that serves as the source of truth for the UI.
- **Master_Passphrase**: The user-supplied secret from which encryption keys are derived; never transmitted off-device.
- **KEK**: The 256-bit Key Encryption Key derived from the Master_Passphrase and a locally generated salt.
- **PHI**: Protected Health Information, including all medication, symptom, condition, and journaling data entered by the user.
- **Vault_Blob**: An encrypted record consisting of sync_version, IV, authentication tag, and Base64 ciphertext for a given vault_type.
- **vault_type**: A logical partition of encrypted data (for example, medications, symptoms, conditions).
- **sync_version**: A monotonically increasing integer used for optimistic concurrency control of a Vault_Blob.
- **Polypharmacy_Engine**: The Client subsystem managing medication profiles, schedules, and safety thresholds.
- **PRN**: A medication taken on an as-needed basis rather than on a fixed schedule.
- **Symptom_Journal**: The Client subsystem for recording symptoms and flare-ups.
- **Condition**: A user-defined diagnosis or syndrome (for example, POTS, MCAS, Ehlers-Danlos) to which records can be tagged.
- **Flare_Up**: A unified event grouping multiple simultaneously active symptoms with a suspected trigger.
- **Insights_Engine**: The Client subsystem performing privacy-preserving local analytics.
- **AI_Insight_Card**: A plain-language summary of a detected statistically significant temporal correlation.
- **Physician_Report**: An on-device generated PDF summarizing polypharmacy, symptom frequency, and correlations.

## Requirements

### Requirement 1: Client-Side Master Key Derivation

**User Story:** As a patient, I want my encryption key derived locally from my passphrase, so that my keys never leave my device.

#### Acceptance Criteria

1. WHEN a user creates a vault, THE Crypto_Engine SHALL generate a random salt of at least 16 bytes from a cryptographically secure random source, unique to that vault.
2. WHEN a user enters the Master_Passphrase, THE Crypto_Engine SHALL derive a 256-bit KEK from the Master_Passphrase and the vault salt using PBKDF2 with at least 600,000 iterations or Argon2id with a memory cost of at least 64 MiB, completing the derivation within 5 seconds.
3. THE Crypto_Engine SHALL perform all key derivation operations strictly on the Client.
4. THE Crypto_Engine SHALL exclude the Master_Passphrase and the KEK from all network requests.
5. WHERE the Client executes in a native iOS or Android runtime, THE Crypto_Engine SHALL execute key derivation using expo-crypto.
6. WHERE the Client executes in a web browser runtime served over HTTPS, THE Crypto_Engine SHALL execute key derivation using the Web Crypto API (window.crypto.subtle), including when the browser runs on an iOS or Android device.
7. IF platform runtime detection is uncertain or ambiguous, THEN THE Crypto_Engine SHALL use expo-crypto as the fallback cryptographic provider.
8. IF the Web_Client is served over a non-secure (non-HTTPS) context, THEN THE Crypto_Engine SHALL refuse to perform cryptographic operations and SHALL display a secure-context-required message within 2 seconds of the attempt.
9. IF the Master_Passphrase is shorter than 12 characters, THEN THE Crypto_Engine SHALL reject the passphrase, SHALL NOT derive a KEK, and SHALL display a minimum-length message.
10. IF key derivation fails, THEN THE Crypto_Engine SHALL abort the operation, SHALL clear any partial key material from memory, and SHALL return a derivation-failure error.

### Requirement 2: Payload Encryption and Decryption

**User Story:** As a patient, I want my health data encrypted with strong authenticated encryption, so that my data is confidential and tamper-evident.

#### Acceptance Criteria

1. WHEN the Client encrypts a payload, THE Crypto_Engine SHALL encrypt the payload using AES-256-GCM with the KEK.
2. WHEN the Client encrypts a payload, THE Crypto_Engine SHALL generate a random 12-byte initialization vector for that payload.
3. WHEN the Client encrypts a payload, THE Crypto_Engine SHALL produce a 16-byte authentication tag.
4. WHEN the Client decrypts a Vault_Blob, THE Crypto_Engine SHALL verify the 16-byte authentication tag using the KEK and the Vault_Blob initialization vector before returning any plaintext.
5. WHEN the authentication tag verification succeeds during decryption, THE Crypto_Engine SHALL return the decrypted plaintext to the caller.
6. IF the authentication tag verification fails during decryption, THEN THE Crypto_Engine SHALL reject the payload, SHALL return a decryption-failure error indicating tampering or key mismatch, and SHALL NOT return any plaintext or partial plaintext to the caller.
7. IF a Vault_Blob submitted for decryption is missing, or contains a malformed or absent initialization vector, authentication tag, or Base64 ciphertext field, THEN THE Crypto_Engine SHALL reject the Vault_Blob and SHALL return a decryption-failure error indicating a malformed Vault_Blob, without returning any plaintext.
8. WHEN the Client transmits an encrypted payload, THE Client SHALL encode the ciphertext as Base64.

### Requirement 3: Session Key Storage and Vault Locking

**User Story:** As a patient, I want my unlocked key protected per platform, so that an unattended device or closed browser tab does not expose my data.

#### Acceptance Criteria

1. WHERE the Client executes in a native iOS or Android runtime, THE Native_Client SHALL store the KEK in the device Secure Enclave using expo-secure-store, including when the native app displays web content in a web view or hybrid mode.
2. WHERE the Native_Client has stored the KEK in the Secure Enclave, THE Native_Client SHALL require biometric unlock (FaceID or Fingerprint) before releasing the KEK.
3. IF biometric unlock fails on 5 consecutive attempts, THEN THE Native_Client SHALL disable biometric unlock for the current session, SHALL retain the KEK in the Secure Enclave, and SHALL require fallback unlock by re-entering the Master_Passphrase.
4. IF biometrics are unavailable on the device, THEN THE Native_Client SHALL require unlock by re-entering the Master_Passphrase.
5. WHERE the Client executes in a web browser runtime, THE Web_Client SHALL retain the KEK only in volatile RAM and SHALL NOT write the KEK to any persistent storage.
6. WHEN the user closes or reloads the Web_Client tab, THE Web_Client SHALL discard the KEK from volatile RAM and SHALL lock the vault.
7. WHILE the vault is unlocked AND no user interaction has occurred for 300 seconds, THE Client SHALL discard the in-memory KEK and SHALL lock the vault.
8. WHILE the vault is locked, THE Client SHALL require re-entry of the Master_Passphrase before decrypting any Vault_Blob.

### Requirement 4: Blind Server Authentication and Authorization

**User Story:** As a patient, I want the server to authenticate me without ever seeing my data, so that the backend remains structurally blind to my PHI.

#### Acceptance Criteria

1. WHEN the Client authenticates with the Sync_Backend, THE Client SHALL authenticate via the WordPress REST API using JWT tokens or WordPress Application Passwords.
2. WHEN the Sync_Backend receives a vault request accompanied by a valid authenticated WordPress user session, THE Sync_Backend SHALL authorize access scoped to that user.
3. IF a vault request presents a missing, invalid, or expired JWT or Application Password, THEN THE Sync_Backend SHALL reject the request, SHALL NOT read or write any Vault_Blob, and SHALL return an authentication-failure indication.
4. THE Sync_Backend SHALL restrict each authenticated user to Vault_Blobs associated with that user's wp_user_id.
5. IF an authenticated user requests a Vault_Blob associated with a different wp_user_id, THEN THE Sync_Backend SHALL deny access, SHALL NOT return that Vault_Blob, and SHALL return an authorization-failure indication.
6. THE Sync_Backend SHALL store and return only encrypted_data fields (IV, authentication tag, and Base64 ciphertext) and SHALL NOT process the plaintext contents of those fields.
7. IF a vault write request is missing the IV, the authentication tag, or the Base64 ciphertext, THEN THE Sync_Backend SHALL reject the entire Vault_Blob, SHALL NOT persist any portion of the request, and SHALL return an error indication identifying the missing field.
8. THE Sync_Backend SHALL exclude the Master_Passphrase and the KEK from all storage and processing.

### Requirement 5: Offline-First Local Source of Truth

**User Story:** As a patient, I want the app to work fully offline, so that I can manage my health data without a connection.

#### Acceptance Criteria

1. THE Client SHALL store all PHI in the Local_Vault as the source of truth.
2. WHEN the Client renders any UI view, THE Client SHALL read PHI exclusively from the Local_Vault and SHALL NOT block rendering on any Sync_Backend response.
3. WHILE the Client has no network connectivity, THE Client SHALL allow the user to create, read, update, and delete PHI records in the Local_Vault.
4. WHEN the user commits a create, update, or delete operation on a PHI record, THE Client SHALL persist the operation to the Local_Vault before confirming completion to the user, such that the change is readable from the Local_Vault on the next read without network connectivity.
5. THE Client SHALL keep offline-first operation enabled at all times and SHALL NOT expose any user-facing or configuration option to disable offline operation.
6. THE Sync_Worker SHALL operate as a background process that bridges the Local_Vault and the Sync_Backend.
7. WHEN network connectivity is restored after offline changes, THE Sync_Worker SHALL begin synchronizing the affected Vault_Blobs with the Sync_Backend within 30 seconds of connectivity restoration.
8. IF synchronization of a Vault_Blob with the Sync_Backend fails, THEN THE Sync_Worker SHALL retain the affected Vault_Blob unchanged in the Local_Vault, SHALL retry synchronization up to 5 attempts, and SHALL surface an indication to the user that synchronization is pending after the final failed attempt.

### Requirement 6: Vault Sync REST Endpoints

**User Story:** As a developer, I want defined REST endpoints for encrypted vault sync, so that the client and server exchange opaque encrypted blobs.

#### Acceptance Criteria

1. THE Sync_Backend SHALL expose custom REST endpoints under the namespace /wp-json/complex-patient/v1/.
2. WHEN the Client sends GET /vault/{vault_type} for a recognized vault_type as an authenticated user, THE Sync_Backend SHALL return the sync_version, IV, authentication tag, and Base64 ciphertext for that vault_type and authenticated user within 5 seconds.
3. WHEN the Client sends POST /vault/{vault_type} for a recognized vault_type as an authenticated user with non-empty IV, authentication tag, and Base64 ciphertext fields, THE Sync_Backend SHALL persist the IV, authentication tag, ciphertext, and sync_version for that vault_type and authenticated user within 5 seconds.
4. WHEN the Sync_Backend persists a POST payload that passes concurrency validation, THE Sync_Backend SHALL increment the stored sync_version by 1 and SHALL set server_updated_at to the server time of persistence.
5. THE Sync_Backend SHALL register these endpoints on the WordPress rest_api_init hook.
6. IF a vault request fails authentication or specifies an unrecognized vault_type, THEN THE Sync_Backend SHALL reject the request without reading or writing any stored data and SHALL return an error indication.
7. IF a GET /vault/{vault_type} request targets a vault_type that has no stored data for the authenticated user, THEN THE Sync_Backend SHALL return a not-found indication.
8. IF a POST /vault/{vault_type} request supplies a mismatched sync_version or omits a required encrypted field, THEN THE Sync_Backend SHALL reject the request, SHALL preserve the existing stored data unchanged, and SHALL return a version-conflict or invalid-payload error indication respectively.

### Requirement 7: Optimistic Concurrency Control

**User Story:** As a patient using multiple devices, I want concurrent edits detected, so that no device silently overwrites another's data.

#### Acceptance Criteria

1. WHEN the Client sends a POST /vault/{vault_type} request, THE Client SHALL include a sync_version, expressed as a non-negative integer, representing the stored version the payload is intended to overwrite.
2. IF a POST /vault/{vault_type} request supplies a sync_version that does not equal the sync_version currently stored in the Sync_Backend, THEN THE Sync_Backend SHALL reject the request with HTTP 409 Conflict, SHALL leave the stored Vault_Blob and its sync_version unchanged, and SHALL return the current stored sync_version in the response.
3. WHEN a POST /vault/{vault_type} request supplies a sync_version equal to the stored sync_version, THE Sync_Backend SHALL accept the write and persist the supplied payload.
4. WHEN no Vault_Blob exists for the vault_type and user, THE Sync_Backend SHALL accept the initial write and SHALL set sync_version to 1.
5. WHEN the Sync_Backend accepts a write to a vault_type, THE Sync_Backend SHALL increment the stored sync_version by 1 and SHALL return the resulting sync_version in the response.
6. IF a POST /vault/{vault_type} request omits the sync_version or supplies a value that is not a non-negative integer, THEN THE Sync_Backend SHALL reject the request with a validation error indicating an invalid sync_version and SHALL leave the stored Vault_Blob and its sync_version unchanged.

### Requirement 8: Client-Side Conflict Resolution Merge

**User Story:** As a patient, I want conflicting edits merged intelligently, so that I do not lose data when devices disagree.

#### Acceptance Criteria

1. WHEN the Client receives an HTTP 409 Conflict from a POST /vault/{vault_type} request, THE Sync_Worker SHALL fetch the latest Vault_Blob for that vault_type from the Sync_Backend within 10 seconds.
2. IF the fetch of the latest Vault_Blob fails or does not complete within 10 seconds, THEN THE Sync_Worker SHALL retain all unsynced local records unchanged and SHALL surface an error indication that the conflict resolution could not be completed.
3. WHEN the Sync_Worker fetches the conflicting Vault_Blob, THE Crypto_Engine SHALL decrypt and verify the integrity of the fetched Vault_Blob on the Client.
4. IF decryption or integrity verification of the fetched Vault_Blob fails, THEN THE Sync_Worker SHALL abort the merge, retain all unsynced local records unchanged, and surface an error indication that the fetched data could not be verified.
5. WHEN reconciling conflicting records, THE Sync_Worker SHALL perform a client-side three-way chronological merge using the last common synced base, the local records, and the fetched remote records, and SHALL retain in the merged result every non-conflicting record present in either the local or the remote set.
6. WHEN two records conflict during the merge, THE Sync_Worker SHALL give precedence to the record with the more recent client-side operational timestamp.
7. IF two conflicting records have client-side operational timestamps that are equal, THEN THE Sync_Worker SHALL give precedence to the record with the lexicographically greater unique record identifier.
8. WHEN the three-way merge is complete, THE Crypto_Engine SHALL re-encrypt the merged result before THE Sync_Worker re-pushes it, and THE Sync_Worker SHALL re-push the merged Vault_Blob to the Sync_Backend only after re-encryption has completed.
9. IF the re-push of the merged Vault_Blob returns a further HTTP 409 Conflict, THEN THE Sync_Worker SHALL re-fetch, re-merge, and re-push up to 3 additional times, and SHALL surface an error indication while retaining all unsynced local records unchanged if all 3 retries are exhausted.

### Requirement 9: Vault Storage Schema

**User Story:** As a developer, I want a defined storage schema, so that encrypted vault data is persisted consistently.

#### Acceptance Criteria

1. WHEN the WordPress plugin is activated, THE Sync_Backend SHALL create a custom MySQL table (for example, wp_complex_patient_vault) using dbDelta, creating the table only if it does not already exist so that repeated activations complete without error.
2. IF the vault table creation fails during activation, THEN THE Sync_Backend SHALL halt the entire plugin activation, return an error indication describing the table creation failure, and leave no partially created vault table.
3. THE Sync_Backend SHALL define the vault table with columns id, wp_user_id, vault_type, iv, auth_tag, ciphertext, sync_version, client_updated_at, and server_updated_at, with id defined as the auto-incrementing primary key.
4. THE Sync_Backend SHALL define the ciphertext column as LONGBLOB.
5. THE Sync_Backend SHALL define a UNIQUE KEY constraint on the combination of wp_user_id and vault_type.
6. IF an insert or update operation would violate the UNIQUE KEY constraint on the combination of wp_user_id and vault_type, THEN THE Sync_Backend SHALL reject the operation, return an error indication identifying the duplicate (wp_user_id, vault_type) combination, and preserve the existing stored row unchanged.

### Requirement 10: Medication Profile Management

**User Story:** As a patient with polypharmacy, I want to record detailed medication profiles, so that I can track everything I take.

#### Acceptance Criteria

1. WHEN a user submits a new medication profile in which the drug name, dosage, form, prescribing physician, and condition treated are each non-empty and between 1 and 200 characters, THE Polypharmacy_Engine SHALL record all five fields as a single medication profile.
2. IF a user submits a medication profile in which any of the required fields (drug name, dosage, form, prescribing physician, condition treated) is empty or exceeds 200 characters, THEN THE Polypharmacy_Engine SHALL reject the profile, SHALL NOT record any portion of the profile, and SHALL return an error indication identifying each invalid field.
3. WHEN a medication profile passes validation, THE Polypharmacy_Engine SHALL store the medication profile in the Local_Vault.
4. WHEN a user saves an edit to an existing medication profile, THE Polypharmacy_Engine SHALL update the corresponding record in the Local_Vault.
5. WHEN the Polypharmacy_Engine updates a medication profile record in the Local_Vault, THE Polypharmacy_Engine SHALL record the client-side operational timestamp of the change.
6. IF a user submits an edit referencing a medication profile that does not exist in the Local_Vault, THEN THE Polypharmacy_Engine SHALL reject the edit, SHALL leave existing records unchanged, and SHALL return an error indication that the profile was not found.

### Requirement 11: Complex Medication Scheduling

**User Story:** As a patient on complex regimens, I want flexible scheduling options, so that my app reflects my real dosing patterns.

#### Acceptance Criteria

1. WHEN a user defines a medication schedule, THE Polypharmacy_Engine SHALL support specific days of the week, alternating days, and rotating interval schedules of every N days where N is an integer from 1 to 30.
2. WHEN a user defines a tapering plan, THE Polypharmacy_Engine SHALL support multi-week tapering schedules of up to 52 weeks with a distinct dosage specified for each phase of the taper.
3. WHERE a medication is configured as PRN, THE Polypharmacy_Engine SHALL record the medication as as-needed and SHALL exclude it from fixed-time scheduling.
4. IF a user submits a schedule with no selected days, an interval N outside 1 to 30, or a taper phase with no dosage, THEN THE Polypharmacy_Engine SHALL reject the schedule, SHALL NOT store the schedule, and SHALL display a message identifying the invalid scheduling input.
5. WHEN a valid medication schedule is saved, THE Polypharmacy_Engine SHALL store the schedule in the Local_Vault.

### Requirement 12: Medication Reminders and Dashboard Indicators

**User Story:** As a patient, I want timely reminders, so that I do not miss scheduled doses.

#### Acceptance Criteria

1. WHEN a scheduled medication time is reached, THE Native_Client SHALL check the device notification state and user notification permissions within 5 seconds of the scheduled time before attempting to trigger a local push notification.
2. WHERE the device notification state and user notification permissions allow notifications, WHEN a scheduled medication time is reached, THE Native_Client SHALL trigger a local push notification within 5 seconds of the scheduled time.
3. WHEN a scheduled medication time is reached, THE Web_Client SHALL update the local dashboard badge indicator within 5 seconds of the scheduled time.
4. IF the device notification state or user notification permissions do not allow notifications when a scheduled medication time is reached, THEN THE Native_Client SHALL update the local dashboard badge indicator and SHALL NOT trigger a local push notification.

### Requirement 13: PRN Quick Log and 24-Hour Safety Threshold

**User Story:** As a patient taking as-needed medications, I want fast logging with overdose protection, so that I stay within safe limits.

#### Acceptance Criteria

1. WHERE a medication is configured as PRN, THE Polypharmacy_Engine SHALL display a one-tap Quick Log button for that medication on the main dashboard.
2. THE Polypharmacy_Engine SHALL exclude PRN medications from the strict time-based schedule grid.
3. THE Polypharmacy_Engine SHALL store a customizable 24-hour cumulative safety limit, expressed in the medication's dose unit within the range 0.01 to 999,999.99, for each PRN medication.
4. IF a user configures a 24-hour safety limit outside the range 0.01 to 999,999.99, THEN THE Polypharmacy_Engine SHALL reject the value, SHALL preserve the previously stored limit, and SHALL display an out-of-range message.
5. WHEN a user taps Quick Log for a PRN medication AND the resulting cumulative amount within the trailing 24 hours would remain at or below the medication's 24-hour safety limit, THE Polypharmacy_Engine SHALL record the configured PRN dose and SHALL confirm the log within 2 seconds.
6. IF logging a PRN dose would cause the cumulative amount within the trailing 24 hours to be strictly greater than the medication's 24-hour safety limit, THEN THE Polypharmacy_Engine SHALL block the immediate log action, SHALL leave the cumulative total unchanged, and SHALL display an override warning prompt.
7. WHEN the user confirms the override warning prompt, THE Polypharmacy_Engine SHALL record the PRN dose and SHALL flag the entry as an acknowledged override.
8. IF the user cancels or dismisses the override warning prompt, THEN THE Polypharmacy_Engine SHALL leave the dose unrecorded and the cumulative total unchanged.

### Requirement 14: Adaptive Polypharmacy View

**User Story:** As a patient on many daily medications, I want a high-density grouped view, so that I am not overwhelmed by a long flat list.

#### Acceptance Criteria

1. WHILE the count of active daily medications is greater than 10, THE Polypharmacy_Engine SHALL display medications grouped into time-of-day blocks presented in the fixed order Morning, Midday, Evening, Night/Bedtime, with medications within each block ordered alphabetically by medication name.
2. WHILE the count of active daily medications is 10 or fewer, THE Polypharmacy_Engine SHALL display medications as a single flat list ordered alphabetically by medication name.
3. WHILE the count of active daily medications is greater than 10, THE Polypharmacy_Engine SHALL assign each active daily medication to a time-of-day block by its scheduled administration time, where Morning is 05:00–10:59, Midday is 11:00–16:59, Evening is 17:00–21:59, and Night/Bedtime is 22:00–04:59, and SHALL place a medication that has multiple scheduled administration times into each corresponding block.
4. WHILE the count of active daily medications is greater than 10, IF an active daily medication has no scheduled administration time or is designated as-needed, THEN THE Polypharmacy_Engine SHALL display that medication in a separate "As Needed" section positioned after the Night/Bedtime block.
5. WHILE the count of active daily medications is greater than 10, IF a time-of-day block contains zero medications, THEN THE Polypharmacy_Engine SHALL omit that block from the display.

### Requirement 15: Symptom Journaling

**User Story:** As a patient with multi-system illness, I want to log detailed symptoms, so that I can track my health over time.

#### Acceptance Criteria

1. WHEN a user submits a symptom entry in which the symptom type and systemic location are non-empty, the severity is an integer from 1 to 10 inclusive, and the duration is a positive numeric value with a time unit, THE Symptom_Journal SHALL record the symptom type, severity, duration, systemic location, and free-text notes as a single symptom entry.
2. WHEN a symptom entry passes validation, THE Symptom_Journal SHALL store the symptom entry in the Local_Vault with its client-side operational timestamp.
3. IF a user submits a symptom entry missing the symptom type, the systemic location, the severity, or the duration, THEN THE Symptom_Journal SHALL reject the entry and SHALL display a message identifying each missing required field.
4. IF a user submits a symptom entry with a severity value that is not an integer or is outside the range 1 to 10, THEN THE Symptom_Journal SHALL reject the entry and SHALL display a valid-range message, completing both the rejection and the message display together.
5. IF a user submits free-text notes exceeding 2000 characters, THEN THE Symptom_Journal SHALL reject the entry and SHALL display a notes-length message.
6. IF a symptom entry is rejected during validation, THEN THE Symptom_Journal SHALL retain the user-entered symptom details as a draft so that the captured information is not lost.

### Requirement 16: Symptom Multi-Tagging

**User Story:** As a patient with overlapping diagnoses, I want to tag symptoms to conditions and medications, so that I can attribute causes.

#### Acceptance Criteria

1. WHEN a user tags a symptom, THE Symptom_Journal SHALL allow the symptom to be linked to between 1 and 50 existing Conditions.
2. IF a user attempts to link a symptom to a Condition that does not exist in the Local_Vault, THEN THE Symptom_Journal SHALL reject the link and display an error message indicating that the selected Condition is not found, while retaining the user's other entered associations.
3. WHEN a user flags a symptom as a suspected adverse reaction, THE Symptom_Journal SHALL allow the symptom to be linked to between 1 and 50 specific medications.
4. WHEN a user saves a symptom's associations, THE Symptom_Journal SHALL persist all symptom-to-Condition and symptom-to-medication associations to the Local_Vault in encrypted form within 2 seconds.
5. IF persistence of a symptom association fails, THEN THE Symptom_Journal SHALL retain the unsaved associations in the editing state, display an error message indicating that the associations were not saved, and block the user from proceeding until the associations are successfully persisted.

### Requirement 17: Batch Flare-Up Logging

**User Story:** As a patient, I want to log a flare as one event, so that I can capture multiple simultaneous symptoms with a trigger.

#### Acceptance Criteria

1. WHEN a user creates a Flare_Up, THE Symptom_Journal SHALL allow batch selection of between 2 and 50 active symptoms (symptoms currently marked as active in the Symptom_Journal) as a single unified event.
2. WHEN a user creates a Flare_Up, THE Symptom_Journal SHALL record one suspected environmental or physiological trigger description of up to 500 characters for the event.
3. WHEN a user saves a Flare_Up, THE Symptom_Journal SHALL store the event with references to each of its constituent selected symptoms in the encrypted Local_Vault within 2 seconds.
4. IF a user attempts to create a Flare_Up with fewer than 2 active symptoms selected, THEN THE Symptom_Journal SHALL reject the creation, preserve the user's current selections, and display an error message indicating that a minimum of 2 symptoms is required.
5. IF storage of a Flare_Up to the Local_Vault fails, THEN THE Symptom_Journal SHALL retain the entered Flare_Up data and display an error message indicating that the save did not complete.

### Requirement 18: Condition Timeline View

**User Story:** As a patient, I want a per-condition timeline, so that I can see everything related to one diagnosis.

#### Acceptance Criteria

1. WHEN a user opens a specific Condition profile, THE Client SHALL display, within 2 seconds, a chronological timeline filtered to only the symptoms, medications, and flare-ups tagged to that Condition, excluding all entries not tagged to that Condition.
2. WHEN a user opens a Condition profile, THE Client SHALL order the timeline entries by their client-side operational timestamps in descending order, with the most recent entry first.
3. IF two timeline entries have equal client-side operational timestamps, THEN THE Client SHALL break the tie using the lexicographically greater unique record identifier so that ordering is deterministic.
4. IF no symptoms, medications, and no flare-ups are tagged to the Condition, THEN THE Client SHALL display an empty-state message in place of the timeline.
5. WHILE at least one symptom, medication, or flare-up is tagged to the Condition, THE Client SHALL display the timeline and SHALL NOT display the empty-state message.

### Requirement 19: Privacy-Preserving Local Analytics

**User Story:** As a privacy-conscious patient, I want analytics run on-device, so that my raw data is never sent to a cloud parser.

#### Acceptance Criteria

1. THE Insights_Engine SHALL compute all correlation and analysis operations within the Client memory sandbox, with no raw or derived analytics data written to any network-bound buffer.
2. THE Insights_Engine SHALL exclude raw symptom and medication entries from all network request payloads, headers, and query parameters.
3. WHEN the user opens the Insights tab, THE Insights_Engine SHALL read the trailing 30 calendar days (measured from the current device date) of symptom and medication data from the Local_Vault and SHALL complete the analysis computation within 3 seconds.
4. WHEN the user opens the Insights tab and at least 1 symptom entry and 1 medication entry exist within the trailing 30 calendar days, THE Insights_Engine SHALL compute the variance in symptom severity relative to medication adherence times over that period.
5. WHEN more than 30 calendar days of symptom and medication data are available, THE Insights_Engine SHALL truncate the analysis input to the most recent 30 calendar days and SHALL proceed with the analysis.
6. IF fewer than 1 symptom entry or fewer than 1 medication entry exist within the trailing 30 calendar days when the user opens the Insights tab, THEN THE Insights_Engine SHALL skip the variance computation and SHALL display a message indicating insufficient data for analysis.
7. IF the analysis computation fails, THEN THE Insights_Engine SHALL display an error message indicating that analysis could not be completed, SHALL retain all Local_Vault entries unchanged, and SHALL transmit no raw symptom or medication data over the network.

### Requirement 20: Temporal Correlation Detection and Insight Cards

**User Story:** As a patient, I want plain-language insights about correlations, so that I can understand patterns in my data.

#### Acceptance Criteria

1. WHEN the Insights_Engine performs its analysis of the trailing 30 days of recorded data, THE Insights_Engine SHALL identify temporal correlations between medication events and symptom severity using candidate lag times ranging from 0 to 14 days.
2. WHEN a detected correlation has a statistical significance at or below the configured significance threshold (default p-value of 0.05), THE Insights_Engine SHALL generate a plain-language AI_Insight_Card that states the two correlated variables, the direction of the correlation, and the associated lag time in days.
3. IF the trailing 30-day window contains fewer than 14 days of tracking history OR fewer than 10 paired medication-and-symptom observations, THEN THE Insights_Engine SHALL display an insufficient-data message that states more tracking history is needed, and SHALL NOT generate any AI_Insight_Card.
4. WHILE the trailing 30-day window contains at least 14 days of tracking history AND at least 10 paired medication-and-symptom observations AND no detected correlation meets the configured significance threshold, THE Insights_Engine SHALL display a no-significant-correlations message that states the data was analyzed but no significant correlation was found.
5. WHERE multiple detected correlations meet the configured significance threshold, THE Insights_Engine SHALL generate a separate AI_Insight_Card for each, up to a maximum of 10 cards ordered by ascending p-value.
6. WHEN the Insights_Engine begins a correlation analysis, THE Insights_Engine SHALL complete the analysis and display a result (one or more AI_Insight_Cards, the insufficient-data message, or the no-significant-correlations message) within 10 seconds.

### Requirement 21: On-Device Physician Report

**User Story:** As a patient, I want an exportable report for my doctor, so that I can share a summary without exposing my raw vault.

#### Acceptance Criteria

1. WHEN a user requests a Physician_Report, THE Client SHALL compile the active polypharmacy list (medications marked as active at the time of the request), the severe symptom frequency over the trailing 90 days, and the AI-identified correlations into a single PDF, and SHALL complete generation within 10 seconds.
2. THE Client SHALL generate the Physician_Report PDF entirely on-device.
3. THE Client SHALL exclude any server-side processing from Physician_Report PDF generation.
4. WHEN computing the severe symptom frequency, THE Client SHALL count only symptom occurrences whose user-recorded severity meets or exceeds the severe level on the symptom severity scale, and SHALL report the count of qualifying occurrences within the trailing 90 days.
5. IF no active medications, severe symptom occurrences, or AI-identified correlations exist at the time of the request, THEN THE Client SHALL generate a PDF in which each corresponding section explicitly indicates that no data is available.
6. IF Physician_Report PDF generation fails, THEN THE Client SHALL retain the vault data unchanged and SHALL display an error message indicating that report generation failed.

### Requirement 22: Universal Client Platform Support

**User Story:** As a patient, I want one app across my devices, so that I have a consistent experience on iOS, Android, and the web.

#### Acceptance Criteria

1. WHEN a patient launches the Client on iOS 15 or later, Android 10 (API level 29) or later, or the latest two major versions of Chrome, Firefox, Safari, or Edge, THE Client SHALL initialize and present the authenticated home interface from a single shared Expo codebase, compiled to native targets via Expo and to the web via React Native Web.
2. THE Client SHALL expose the same set of patient-facing features and user workflows on iOS, Android, and web, such that any health-data operation available on one platform is available on the others.
3. THE Platform SHALL organize all shared cryptographic primitives in a dedicated package (packages/crypto-engine), and each Client target (iOS, Android, web) SHALL invoke cryptographic operations exclusively through this package without platform-specific reimplementation, producing identical cryptographic outputs for identical inputs across all targets.
4. WHEN the Client initializes the Local_Vault, THE Client SHALL persist it using expo-sqlite or encrypted react-native-mmkv, and SHALL store all Local_Vault contents encrypted at rest such that no plaintext health data is written to the storage backend.
5. IF Local_Vault initialization or unlock fails, THEN THE Client SHALL block access to encrypted health data, retain any previously persisted encrypted data without modification, and present an error message indicating that local storage initialization failed.

### Requirement 23: Age Eligibility Gate

**User Story:** As the platform operator, I want to confirm during onboarding that a user is at least 16 years old before any vault is created, so that the app is offered only to eligible users with a simple, self-attested check that requires no locality detection.

#### Acceptance Criteria

1. WHEN a new user begins onboarding, THE Client SHALL present an age-eligibility screen that collects only the user's birth month and birth year, before the Master_Passphrase setup and before any KEK derivation or Local_Vault creation.
2. THE Client SHALL compute eligibility against a fixed minimum age of 16 years, applied uniformly to all users without any locality or jurisdiction detection.
3. WHEN computing eligibility from the supplied birth month and birth year, THE Client SHALL treat the user's birthday as occurring at the end of the supplied birth month, such that a user is eligible only when the end of their birth month plus 16 years is on or before the current date.
4. WHEN the supplied birth month and birth year satisfy the minimum-age computation, THE Client SHALL mark the session as age-eligible and SHALL allow onboarding to proceed to Master_Passphrase setup.
5. IF the supplied birth month and birth year do not satisfy the minimum-age computation, THEN THE Client SHALL block onboarding, SHALL NOT derive a KEK or create a Local_Vault, and SHALL present a terminal ineligibility screen stating that the app is available only to people 16 and older.
6. WHILE the user is on the terminal ineligibility screen, THE Client SHALL NOT offer a path that returns to the age-eligibility screen for re-entry, and SHALL limit available actions to closing the app (native) or remaining on a neutral ineligibility page (web), and SHALL NOT redirect the user to any unrelated third-party site.
7. WHEN a user is determined ineligible, THE Client SHALL persist an ineligibility flag in local device storage outside the encrypted Local_Vault, such that the flag is readable without a KEK.
8. WHEN the Client launches AND a persisted ineligibility flag is present, THE Client SHALL present the terminal ineligibility screen directly without presenting the age-eligibility screen or any onboarding step.
9. IF the user submits the age-eligibility screen with a missing birth month, a missing birth year, or a birth month/year combination that is not a valid calendar month in the past, THEN THE Client SHALL reject the submission, SHALL NOT compute eligibility as satisfied, and SHALL display a message identifying the invalid input.
10. THE Client SHALL collect only birth month and birth year for the eligibility check, SHALL NOT collect a full date of birth, and SHALL NOT transmit the birth month or birth year to the Sync_Backend.
