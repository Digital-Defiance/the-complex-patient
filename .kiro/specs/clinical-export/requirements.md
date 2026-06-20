# Requirements Document

## Introduction

Users need to share decrypted health data with a clinician or import it into another system without handing over Complex Patient vault blobs, encryption keys, or sync artifacts. This feature delivers an on-device **clinical export**: a standards-based FHIR R4 JSON `Bundle` wrapped in a **password-protected ZIP** for transport only.

The export path reads exclusively from the decrypted Local_Vault projection via `home.read`. It performs no network I/O and does not involve the Sync_Backend. Import of exported files is out of scope for v1.

## Glossary

- **Clinical_Export**: The user-initiated export of decrypted domain records as a FHIR R4 JSON Bundle.
- **Export_ZIP**: A ZIP archive containing the FHIR JSON file, encrypted with a user-chosen zip password (AES-256).
- **Export_Consent**: Explicit UI acknowledgment that exported data is readable without the app; only the ZIP password adds protection.
- **Local_Vault**: Client-side encrypted database; export reads its decrypted projection only.
- **PHI**: Protected health information (medications, symptoms, conditions, flares, associations, PRN logs).
- **Vault_Blob**: Encrypted partition payload; MUST NOT appear in export output.

## Requirements

### Requirement 1: On-Device FHIR Export

**User Story:** As a patient, I want to export my health data in a standard format, so that my doctor or another system can read it without Complex Patient.

#### Acceptance Criteria

1. WHEN the user completes export consent and provides a zip password, THE Clinical_Export SHALL build a FHIR R4 JSON `Bundle` from decrypted records read via `home.read` for partitions `medications`, `symptoms`, `conditions`, `flares`, and `associations`.
2. THE Clinical_Export SHALL map medications to `MedicationStatement`, conditions to `Condition`, symptoms to `Observation`, and flare-ups to `Encounter` resources.
3. THE Clinical_Export output SHALL NOT contain vault encryption artifacts (`Vault_Blob`, ciphertext, KEK, KDF parameters, or merge/sync metadata beyond FHIR-relevant timestamps).
4. THE Clinical_Export SHALL perform all serialization and packaging on-device with no Sync_Backend or external network calls.

### Requirement 2: Password-Protected ZIP Wrapper

**User Story:** As a patient, I want the export file protected by a password I choose, so that casual interception does not expose my data.

#### Acceptance Criteria

1. WHEN export succeeds, THE Export_ZIP SHALL contain a single JSON file named `complex-patient-export.fhir.json`.
2. THE Export_ZIP SHALL use AES-256 zip encryption with the user-supplied password.
3. IF the zip password is empty or confirmation does not match, THEN THE Export_Screen SHALL block export and show a validation message.

### Requirement 3: Explicit Consent

**User Story:** As a patient, I want a clear warning before export, so that I understand the data will be readable outside the app.

#### Acceptance Criteria

1. THE Export_Screen SHALL require an explicit consent checkbox before enabling export.
2. THE consent copy SHALL state that exported data is decrypted and readable without Complex Patient, and that the zip password is transport protection only.
3. THE Export_Screen SHALL read data exclusively through `home.read` while status is `ready`.

### Requirement 4: Navigation and Parity

**User Story:** As a user on mobile or web, I want to reach export from home, so that I can share data from any supported client.

#### Acceptance Criteria

1. THE Home_Screen SHALL expose a navigation entry for Clinical Export on both Mobile_App and Web_App.
2. THE Export_Screen SHALL be implemented once in `@complex-patient/ui` and consumed by thin Expo Router route files in `apps/mobile` and `apps/web`.
3. WHEN export bytes are ready, THE route layer SHALL trigger platform save/share (browser download on web; share/save adapter on mobile).

### Requirement 5: Non-Goals (v1)

1. THE Clinical_Export SHALL NOT support import of exported files in v1.
2. THE Clinical_Export SHALL NOT emit C-CDA or FHIR XML in v1 (JSON Bundle only).
3. THE Clinical_Export SHALL NOT re-encrypt data with vault crypto or include portable vault blobs.
