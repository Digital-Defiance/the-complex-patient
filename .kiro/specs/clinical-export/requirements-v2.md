### Requirement 6: Import Preview (v2)

**User Story:** As a patient, I want to open a previously exported zip and see what it contains, so that I can verify the file before any future vault merge.

#### Acceptance Criteria

1. WHEN the user selects an export ZIP and enters the correct password on web, THE Import_Screen SHALL unpack the archive on-device and display a read-only summary (resource counts, export timestamp, Complex Patient export recognition).
2. IF the password is wrong or the zip does not contain `complex-patient-export.fhir.json`, THEN THE Import_Screen SHALL show an error and SHALL NOT modify the Local_Vault.
3. THE Import_Screen SHALL perform preview work with no Sync_Backend involvement.

### Requirement 7: Export Safety Tests (v2)

**User Story:** As a developer, I want property tests over export output, so that vault artifacts and deleted records cannot regress silently.

#### Acceptance Criteria

1. FOR ANY generated active export source, THE serialized FHIR JSON SHALL pass `assertNoVaultArtifacts`.
2. FOR ANY generated export source, THE FHIR bundle resource ids SHALL match `expectedExportResourceIds(source)` exactly.
3. FOR ANY successful export, unpacking with the same password SHALL reproduce the same resource id set.

### Requirement 9: Vault Merge (v2.1)

**User Story:** As a patient, I want to merge a recognized export into my vault, so that I can restore or combine data from another device.

#### Acceptance Criteria

1. WHEN the user previews a Complex Patient export and confirms merge consent, THE Import_Screen SHALL parse FHIR resources back into domain records and merge them into Local_Vault partitions through `home.commit`.
2. THE merge policy SHALL upsert by record id and prefer the incoming record when its `op_timestamp` is newer than or equal to the local record.
3. Local records not present in the import SHALL remain unchanged.
4. IF merge commit fails, THEN THE Import_Screen SHALL show an error and SHALL leave the vault unchanged for that failed partition.

### Requirement 10: Mobile File Pick and Share (v2.2)

**User Story:** As a mobile user, I want to pick an export zip and share a generated export through native sheets, so that import/export parity matches web.

#### Acceptance Criteria

1. WHEN the user taps Choose file on Mobile_App, THE Import_Route SHALL use `expo-document-picker` to load zip bytes on-device.
2. WHEN export completes on Mobile_App, THE Export_Route SHALL write the zip to cache and invoke `expo-sharing` instead of a data-URL share payload.
3. THE mobile adapters SHALL remain in `apps/mobile` and SHALL NOT add Expo native dependencies to `@complex-patient/ui`.
