# Implementation Plan: The Complex Patient

## Overview

This plan implements the zero-knowledge E2EE health platform bottom-up so that each layer is validated before the layer above depends on it. The build order is: monorepo scaffolding → domain models and validation → crypto-engine → local-vault → sync-engine and WordPress backend → client subsystems (Polypharmacy, Symptom Journal, Insights) → universal UI integration and session key store.

The Expo client is implemented in **TypeScript** (per the design's interface contracts) and the WordPress blind sync plugin in **PHP/SQL**. Property-based tests are included for every correctness property the design defines (Properties 1–17): crypto round-trip, tamper-evidence, malformed-blob rejection, IV uniqueness, KDF determinism/salt sensitivity, short-passphrase rejection, cross-platform crypto parity, three-way merge no-data-loss/determinism/idempotence/commutativity, the zero-knowledge network invariant, optimistic concurrency, PRN safety thresholds, the adaptive polypharmacy view boundary, condition-timeline ordering, and insights gating. Every task in this plan — including all unit, integration, and property-based test sub-tasks — is required and will be implemented. There are no optional tasks.

## Tasks

- [x] 1. Scaffold the monorepo workspace and shared tooling
  - Create the `expo/` workspace (`apps/mobile`, `apps/web`, and empty `packages/crypto-engine`, `packages/local-vault`, `packages/sync-engine`, `packages/domain`, `packages/ui`, `packages/insights`) with a package manager workspace config and shared TypeScript config
  - Create the `wp/complex-patient/` plugin directory with the plugin bootstrap header file
  - Set up the test runner for TypeScript packages (Jest/Vitest) and a property-based testing library (fast-check), and a PHP test harness (PHPUnit) for the plugin
  - _Requirements: 22.1, 22.2, 22.3_

- [x] 2. Implement domain models and validation (`packages/domain`)
  - [x] 2.1 Define core record and partition types
    - Implement `VaultRecord` (`id`, `op_timestamp`, optional `deleted`), `PartitionPayload<T>`, and the `VaultType` union (`medications`, `symptoms`, `conditions`, `flares`, `associations`)
    - _Requirements: 8.5, 8.6, 8.7_

  - [x] 2.2 Implement medication domain models and validation
    - Implement `MedicationProfile`, `MedicationSchedule` variants (`prn`, `weekly`, `alternating`, `rotating-interval`, `taper`), `TaperPhase`, `PrnConfig`, `PrnLog`, and `Weekday`/`TimeBlock` types
    - Implement profile field validation (five required fields, 1–200 chars, per-field error reporting), schedule validation (weekly day selection, interval N ∈ [1,30], taper phase dosage required), and PRN safety-limit range validation [0.01, 999999.99]
    - _Requirements: 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 13.3, 13.4_

  - [x] 2.3 Implement symptom, condition, and flare domain models and validation
    - Implement `Condition`, `SymptomEntry`, `SymptomDraft`, `Association`, `FlareUp`, and `TimeUnit` types
    - Implement symptom validation (type/location non-empty, severity integer 1–10, positive duration with unit, notes ≤2000 chars, per-field messages), association cardinality validation (1–50 conditions, 1–50 medications), and flare validation (2–50 symptoms, trigger ≤500 chars)
    - _Requirements: 15.1, 15.3, 15.4, 15.5, 16.1, 16.3, 17.1, 17.2_

  - [x] 2.4 Write unit tests for domain validation
    - Test boundary cases for field length, severity range, interval range, PRN limit range, and cardinality limits
    - Test per-field error reporting and rejection of whole records on invalid input
    - _Requirements: 10.2, 11.4, 13.4, 15.3, 15.4, 15.5, 16.1, 17.1_

  - [x] 2.5 Implement the age-eligibility gate function
    - Implement `evaluateAgeGate(input, now)` as a pure deterministic function in `packages/domain`: validate birth month (integer 1–12) and four-digit year and reject non-past month-year with `INVALID_AGE_INPUT`; compute eligibility against the fixed 16-year minimum by treating the birthday as the end of the supplied birth month (`endOfMonth(birthYear, birthMonth) + 16 years <= now`); apply uniformly with no locality detection; collect only month/year (no full DOB)
    - _Requirements: 23.1, 23.2, 23.3, 23.9, 23.10_

  - [x] 2.6 Write unit and property tests for the age gate
    - Unit-test the 16th-birthday boundary (15y11m blocked, exactly-16-at-end-of-month eligible), invalid/missing/future month-year rejection, and determinism with an injected `now`
    - **Property 18: Age gate is deterministic and threshold-correct**
    - **Validates: Requirements 23.2, 23.3, 23.5, 23.9**

- [x] 3. Implement the Crypto_Engine (`packages/crypto-engine`)
  - [x] 3.1 Define crypto interfaces and runtime provider selection
    - Implement `CryptoEngine`, `KdfParams`, `EncryptedPayload`, `DeriveResult`, `DecryptResult` types and the `selectProvider(ctx)` runtime decision (native → expo-crypto; web non-secure → refuse `SECURE_CONTEXT_REQUIRED`; web+HTTPS+subtle → web-subtle; ambiguous → expo-crypto fallback)
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 22.3_

  - [x] 3.2 Implement key derivation (KEK)
    - Implement `generateSalt()` (≥16-byte CSPRNG) and `deriveKEK()` for PBKDF2 (≥600,000 iterations) and Argon2id (≥64 MiB) with parameters stored alongside the salt
    - Reject passphrases shorter than 12 chars (`PASSPHRASE_TOO_SHORT`), zero partial key material and return `DERIVATION_FAILED` on failure, and enforce the strictly client-side / never-transmitted constraint
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.9, 1.10_

  - [x] 3.3 Implement AES-256-GCM encryption and decryption
    - Implement `encrypt()` (fresh random 12-byte IV, 16-byte tag, Base64 output) and `decrypt()` (verify tag before returning any plaintext, split appended tag from provider output)
    - Reject malformed blobs (`MALFORMED_BLOB`) and tag failures (`AUTH_TAG_FAILED`) without returning partial plaintext
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 3.4 Write property test for encryption round-trip
    - **Property 1: Encryption round-trip preserves plaintext**
    - **Validates: Requirements 2.1, 2.5, 2.8**

  - [x] 3.5 Write property test for tamper-evidence
    - **Property 2: Tamper-evidence — mutation always fails closed**
    - **Validates: Requirements 2.4, 2.6**

  - [x] 3.6 Write property test for malformed-blob rejection
    - **Property 3: Malformed blobs are rejected without decryption**
    - **Validates: Requirements 2.7**

  - [x] 3.7 Write property test for IV uniqueness
    - **Property 4: IV uniqueness across encryptions**
    - **Validates: Requirements 2.2**

  - [x] 3.8 Write property test for KDF determinism and salt sensitivity
    - **Property 5: KDF determinism and salt sensitivity**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 3.9 Write property test for short-passphrase rejection
    - **Property 6: Short passphrases never derive a key**
    - **Validates: Requirements 1.9**

  - [x] 3.10 Write property test for cross-platform crypto parity
    - **Property 7: Cross-platform crypto parity** — encrypt with one provider (`web-subtle` or `expo-crypto`) and decrypt with the other, asserting identical derived KEKs and identical decrypt(encrypt) outputs for identical inputs
    - **Validates: Requirements 22.3**

  - [x] 3.11 Write unit tests for KDF rules and provider selection
    - Test derivation-failure cleanup (no partial key material) and salt length, and the `selectProvider` decision table (native, web non-secure refusal, web+HTTPS+subtle, ambiguous fallback)
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.10_

- [x] 4. Implement the Local_Vault persistence layer (`packages/local-vault`)
  - [x] 4.1 Implement the LocalVault interface over encrypted storage
    - Implement `init()`, `readPartition()`, atomic `writePartition()`, `readBase()`, `setBase()` backed by expo-sqlite (default) / encrypted MMKV, storing only ciphertext at rest
    - On init/unlock failure, block access, retain existing encrypted data unchanged, and surface a local-storage-initialization-failed error
    - _Requirements: 5.1, 5.4, 22.4, 22.5_

  - [x] 4.2 Write unit tests for Local_Vault persistence
    - Test atomic write-before-confirm, read-back without network, encrypted-at-rest (no plaintext written), and init-failure handling
    - _Requirements: 5.1, 5.4, 22.4, 22.5_

- [x] 5. Checkpoint - crypto and storage foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement the WordPress blind sync backend (`wp/complex-patient`)
  - [x] 6.1 Implement plugin activation and the vault MySQL schema
    - Implement `dbDelta` activation creating `wp_complex_patient_vault` idempotently with columns `id` (auto-increment PK), `wp_user_id`, `vault_type`, `iv`, `auth_tag`, `ciphertext` (LONGBLOB), `sync_version`, `client_updated_at`, `server_updated_at`, and a UNIQUE KEY on `(wp_user_id, vault_type)`
    - Halt activation with an error and leave no partial table on creation failure
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 6.2 Implement the vault repository (wpdb access)
    - Implement read/write scoped by `wp_user_id` and `vault_type`, returning only `iv`, `auth_tag`, `ciphertext`, `sync_version`; reject UNIQUE KEY violations preserving the existing row
    - _Requirements: 4.4, 4.6, 9.6_

  - [x] 6.3 Implement authentication and authorization middleware
    - Validate JWT / Application Password; reject missing/invalid/expired credentials with an auth-failure response and no read/write; scope access to the caller and deny cross-user `wp_user_id` access
    - Exclude Master_Passphrase and KEK from all storage and processing
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.8_

  - [x] 6.4 Implement the vault REST controller and routes
    - Register `GET`/`POST /wp-json/complex-patient/v1/vault/{vault_type}` on `rest_api_init`; GET returns the blob within 5s or 404; POST validates required encrypted fields and persists within 5s, setting `server_updated_at`
    - Reject unrecognized vault_type and missing IV/tag/ciphertext fields, persisting nothing on rejection
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 4.7_

  - [x] 6.5 Implement optimistic concurrency control
    - Accept writes when supplied `sync_version` equals stored version and increment by 1; initial write sets version to 1; reject mismatched version with HTTP 409 returning the current stored `sync_version` and leaving data unchanged; reject missing/non-negative-integer `sync_version` with a validation error
    - _Requirements: 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 6.6 Write integration tests for the REST endpoints
    - Test auth rejection, cross-user denial, unrecognized vault_type, missing-field rejection, GET 404, and the GET/POST success contract
    - _Requirements: 4.3, 4.5, 6.2, 6.3, 6.6, 6.7, 4.7_

  - [x] 6.7 Write property test for optimistic concurrency
    - **Property 13: Optimistic concurrency correctness** — a stale `sync_version` POST is rejected with 409 leaving the stored blob and version unchanged; an equal-version POST is accepted and increments the stored version by exactly 1
    - **Validates: Requirements 7.2, 7.5**

- [x] 7. Checkpoint - backend contract complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the Sync_Engine (`packages/sync-engine`)
  - [x] 8.1 Implement the three-way merge function
    - Implement `threeWayMerge(base, local, remote)`: union of ids in local or remote, take the changed side for one-sided changes, resolve conflicts by more-recent `op_timestamp`, tie-break by lexicographically greater `id`, preserve soft-delete tombstones
    - _Requirements: 8.5, 8.6, 8.7_

  - [x] 8.2 Write property test for merge no-data-loss
    - **Property 8: Three-way merge loses no non-conflicting data**
    - **Validates: Requirements 8.5**

  - [x] 8.3 Write property test for deterministic conflict resolution
    - **Property 9: Deterministic conflict resolution** — conflicting records resolve to the more recent `op_timestamp`, ties to the lexicographically greater id, and the merge is a deterministic pure function of `(base, local, remote)`
    - **Validates: Requirements 8.6, 8.7**

  - [x] 8.4 Write property test for merge idempotence and convergence
    - **Property 10: Merge idempotence and convergence**
    - **Validates: Requirements 8.5, 8.6, 8.7**

  - [x] 8.5 Write property test for commutativity of non-conflicting union
    - **Property 11: Commutativity of non-conflicting union**
    - **Validates: Requirements 8.5**

  - [x] 8.6 Implement the offline sync queue and connectivity-triggered sync
    - Implement `enqueue(vaultType)`, `onConnectivityRestored()` beginning sync within 30s, and `syncPartition()` performing the POST; on failure retain the blob unchanged, retry up to 5 attempts, then surface a "sync pending" indication
    - _Requirements: 5.6, 5.7, 5.8_

  - [x] 8.7 Implement the 409 conflict-resolution protocol
    - On 409: fetch latest blob within 10s, decrypt/verify via Crypto_Engine, run `threeWayMerge`, re-encrypt, and re-push only after re-encryption; retry the conflict cycle up to 3 additional times; on fetch/verify failure or exhausted retries, retain unsynced local records unchanged and surface an error
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.8, 8.9_

  - [x] 8.8 Write integration tests for the sync conflict cycle
    - Test the 409 → fetch → merge → re-push flow, retry exhaustion, and verification-failure abort against the mocked backend contract
    - _Requirements: 8.1, 8.2, 8.4, 8.9_

- [x] 9. Checkpoint - sync and merge complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement the Session Key Store (consumed by `apps/mobile`, `apps/web`)
  - [x] 10.1 Implement the platform-specific key store behind a shared interface
    - Implement `SessionKeyStore` (`store`, `unlock`, `lock`, `isUnlocked`): native stores KEK in Secure Enclave via expo-secure-store with biometric unlock, 5-failure lockout to passphrase fallback, and passphrase fallback when biometrics unavailable; web keeps KEK in volatile RAM only and discards on tab close/reload
    - Implement the shared 300s idle-timeout auto-lock that discards the in-memory KEK and locks the vault on all platforms; require passphrase re-entry while locked
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 10.2 Write unit tests for key store locking behavior
    - Test biometric-failure lockout, idle-timeout discard, web volatile-only retention, and locked-state decrypt blocking
    - _Requirements: 3.3, 3.6, 3.7, 3.8_

- [x] 11. Implement the Polypharmacy_Engine (`packages/ui` logic + `packages/domain` wiring)
  - [x] 11.1 Implement medication profile CRUD against the Local_Vault
    - Create/edit/store validated profiles in the `medications` partition, record `op_timestamp` on update, and reject edits to non-existent profiles leaving records unchanged
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.5_

  - [x] 11.2 Implement PRN Quick Log and 24-hour safety threshold
    - Implement one-tap Quick Log, trailing-24h cumulative check against `safetyLimit24h`, override warning prompt with acknowledged-override flagging, and cancel/dismiss leaving the total unchanged
    - _Requirements: 13.1, 13.2, 13.5, 13.6, 13.7, 13.8_

  - [x] 11.3 Write property test for PRN safety threshold enforcement
    - **Property 14: PRN safety threshold enforcement** — the Quick Log is blocked iff the resulting trailing-24h cumulative would be strictly greater than the safety limit and no override is acknowledged; otherwise the dose is recorded and the cumulative reflects exactly the added amount
    - **Validates: Requirements 13.5, 13.6**

  - [x] 11.4 Write unit tests for PRN safety threshold logic
    - Test at-limit acceptance, over-limit blocking, override acknowledgement, and cancel leaving cumulative unchanged
    - _Requirements: 13.5, 13.6, 13.7, 13.8_

  - [x] 11.5 Implement the adaptive polypharmacy view function
    - Implement `buildPolypharmacyView(meds)`: >10 active → time-of-day blocks in fixed order with alphabetical ordering, multi-time meds in each block, "As Needed" section after Night/Bedtime, empty blocks omitted; ≤10 active → flat alphabetical list
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 11.6 Write property test for the adaptive polypharmacy view boundary
    - **Property 15: Adaptive polypharmacy view boundary** — >10 active medications produce the fixed-order grouped blocks (alphabetical within block, multi-time meds in each matching block, trailing "As Needed" section, empty blocks omitted); ≤10 produce a single alphabetical flat list
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**

  - [x] 11.7 Write unit tests for the adaptive view function
    - Test the >10 / ≤10 boundary, time-block window assignment, multi-block placement, and empty-block omission
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 11.8 Implement medication reminders and dashboard indicators
    - On scheduled time: native checks notification permission/state within 5s and triggers a local push (or updates the dashboard badge when not permitted); web updates the dashboard badge within 5s
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 12. Implement the Symptom_Journal (`packages/ui` logic + `packages/domain` wiring)
  - [x] 12.1 Implement symptom logging with draft retention
    - Store validated symptom entries in the `symptoms` partition with `op_timestamp`; on validation rejection retain entered details as a draft
    - _Requirements: 15.1, 15.2, 15.6_

  - [x] 12.2 Implement symptom multi-tagging and association persistence
    - Link symptoms to 1–50 existing conditions and 1–50 medications; reject links to non-existent conditions while retaining other associations; persist encrypted within 2s; on failure retain editing state and block progression
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 12.3 Implement batch flare-up logging
    - Batch-select 2–50 active symptoms into one event with a trigger ≤500 chars, store references within 2s; reject <2 symptoms preserving selection; on storage failure retain data with an error
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 12.4 Implement the condition timeline projection
    - Implement `buildConditionTimeline(...)`: filter to entries tagged to the condition, order by `op_timestamp` DESC with lexicographic-id tie-break, empty-state when nothing tagged, timeline otherwise
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

  - [x] 12.5 Write property test for condition timeline ordering determinism
    - **Property 16: Condition timeline ordering determinism** — `buildConditionTimeline` returns only tagged entries ordered by `op_timestamp` descending with lexicographically-greater-id tie-break, producing a total, deterministic order
    - **Validates: Requirements 18.1, 18.2, 18.3**

  - [x] 12.6 Write unit tests for journaling and timeline logic
    - Test draft retention on rejection, association cardinality and unknown-condition handling, flare minimum-symptom rule, and timeline empty-state
    - _Requirements: 15.6, 16.2, 17.4, 18.4_

- [x] 13. Implement the Insights_Engine (`packages/insights`)
  - [x] 13.1 Implement the sandboxed 30-day analysis pipeline
    - Read trailing 30 calendar days from the Local_Vault in-memory, truncate older data, compute severity-vs-adherence variance within 3s; skip with insufficient-data message when <1 symptom or <1 medication; never write raw/derived analytics to any network-bound buffer, header, or query parameter; on failure retain vault unchanged with an error and transmit nothing
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

  - [x] 13.2 Implement temporal correlation detection and insight cards
    - Detect correlations across candidate lags 0–14 days; generate plain-language `AIInsightCard`s for p ≤ threshold stating variables/direction/lag; gate with insufficient-data message (<14 days history OR <10 paired observations); no-significant-correlations message when sufficient but none significant; max 10 cards ascending by p-value; complete within 10s
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [x] 13.3 Implement the on-device Physician_Report PDF
    - Compile active polypharmacy, trailing-90-day severe-symptom frequency, and correlation cards into a PDF entirely on-device within 10s; mark empty sections explicitly; on failure retain vault unchanged with an error
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6_

  - [x] 13.4 Write property test for insights gating
    - **Property 17: Insights gating is mutually exclusive and threshold-correct** — for any trailing-30-day dataset the engine produces exactly one outcome: insufficient-data, no-significant-correlations, or at most 10 cards ascending by p-value
    - **Validates: Requirements 19.6, 20.3, 20.4, 20.5**

  - [x] 13.5 Write unit tests for insights gating and report sections
    - Test insufficient-data gating thresholds, card ordering/cap, severe-symptom 90-day count, and empty-section reporting; assert no raw data leaves the sandbox
    - _Requirements: 19.2, 19.6, 20.3, 20.4, 20.5, 21.4, 21.5_

- [x] 14. Checkpoint - subsystems complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Wire the universal client together (`apps/mobile`, `apps/web`, `packages/ui`)
  - [x] 15.1 Implement the Zustand store mirroring decrypted partitions
    - Hydrate stores by decrypting partitions on unlock, write through subsystem engines to the Local_Vault before reflecting committed state, and clear PHI stores together with the KEK on lock/idle timeout
    - _Requirements: 5.1, 5.2, 5.4, 3.6, 3.7_

  - [x] 15.2 Wire offline-first read/write paths and the Sync_Worker
    - Connect UI reads to the Local_Vault (never blocking on network), route create/update/delete through engines → encrypt → atomic persist → confirm → enqueue sync, and surface sync-pending/conflict indications; keep offline operation always enabled with no disable option
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 15.3 Wire authentication and platform entry points
    - Implement mobile (Expo Router, expo-secure-store, expo-notifications) and web (HTTPS, window.crypto.subtle) entry points presenting the authenticated home interface from the shared codebase with identical feature parity, connected to the key store and Sync_Backend auth
    - _Requirements: 22.1, 22.2, 4.1_

  - [x] 15.6 Wire the age-gate onboarding flow and ineligibility persistence
    - Add the age-eligibility screen (birth month + year) as the first onboarding step before Master_Passphrase setup/KEK derivation, gating on `evaluateAgeGate`; on ineligibility persist an ineligibility flag in device storage outside the Local_Vault (expo-secure-store/AsyncStorage native, localStorage web) and present a terminal, non-recoverable ineligibility screen (close on native / neutral page on web, no third-party redirect); on launch, check the flag before any onboarding step and route straight to the ineligibility screen; never transmit month/year to the Sync_Backend
    - _Requirements: 23.1, 23.4, 23.5, 23.6, 23.7, 23.8, 23.10_

  - [x] 15.4 Write integration tests for the universal end-to-end flow
    - Test unlock → decrypt → render, local write → enqueue → sync, and lock-clears-store across a mocked native and web runtime
    - _Requirements: 5.2, 5.4, 22.2, 22.3_

  - [x] 15.5 Write property test for the zero-knowledge network invariant
    - Implement a network spy wrapping the HTTP client (and, on web, `fetch`/`XMLHttpRequest`) that, during randomized sync + analytics runs over generated PHI, captures every outbound request body, header, and query string
    - **Property 12: Zero-knowledge network invariant** — no outbound network request body, header, or query parameter contains plaintext PHI or derived analytics values; only `{ sync_version, iv, auth_tag, ciphertext }` envelopes cross the boundary
    - **Validates: Requirements 4.6, 4.8, 19.1, 19.2**

- [x] 16. Final checkpoint - full platform integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Every task, including all unit, integration, and property-based test sub-tasks, is required and will be implemented. There are no optional tasks and nothing is skippable for an MVP.
- Each task references specific granular requirement clauses for traceability.
- Property-based tests cover all 17 correctness properties from the design: Properties 1–7 (crypto: round-trip, tamper-evidence, malformed-blob rejection, IV uniqueness, KDF determinism/salt, short-passphrase rejection, cross-platform parity), Properties 8–11 (sync/merge: no-data-loss, deterministic conflict resolution, idempotence/convergence, commutativity), Property 12 (zero-knowledge network invariant), Property 13 (optimistic concurrency), and Properties 14–17 (domain logic: PRN safety threshold, adaptive view boundary, condition-timeline ordering, insights gating). Unit and integration tests validate examples, edge cases, and the REST/sync contracts.
- The cross-platform crypto parity test (Property 7) encrypts with one provider and decrypts with the other, asserting identical KEKs and outputs (Req 22.3).
- Checkpoints provide incremental validation between layers (foundation, backend, sync, subsystems, integration).
- The build is bottom-up so there is no orphaned code: domain and crypto underpin the vault, the vault underpins sync and the backend, and the subsystems and UI integrate everything in the final waves.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.5", "3.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.6", "3.2", "6.2", "6.3"] },
    { "id": 3, "tasks": ["2.4", "3.3", "4.1", "6.4"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "4.2", "6.5", "8.1"] },
    { "id": 5, "tasks": ["6.6", "6.7", "8.2", "8.3", "8.4", "8.5", "10.1"] },
    { "id": 6, "tasks": ["8.6", "8.7", "10.2", "11.1", "12.1", "13.1"] },
    { "id": 7, "tasks": ["8.8", "11.2", "11.5", "11.8", "12.2", "12.3", "12.4", "13.2", "13.3"] },
    { "id": 8, "tasks": ["11.3", "11.4", "11.6", "11.7", "12.5", "12.6", "13.4", "13.5", "15.1"] },
    { "id": 9, "tasks": ["15.2", "15.3"] },
    { "id": 10, "tasks": ["15.4", "15.5", "15.6"] }
  ]
}
```
