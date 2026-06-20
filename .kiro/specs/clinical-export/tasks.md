# Implementation Plan

- [x] 1. Create `@complex-patient/clinical-export` package scaffold
  - Add workspace entry, `package.json`, `tsconfig.json`, public API
  - _Requirements: 1.1, 2.1_

- [x] 2. Implement FHIR R4 Bundle builder
  - Map medications, conditions, symptoms, flares, PRN logs, associations
  - Filter soft-deleted records; add Provenance entry
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Implement ZIP packer with AES-256 password
  - `packExportZip` using `@zip.js/zip.js`
  - _Requirements: 2.1, 2.2_

- [x] 4. Add unit tests for FHIR output and ZIP round-trip
  - Assert no vault/crypto fields in serialized JSON
  - _Requirements: 1.3, 2.2_

- [x] 5. Implement `ExportScreen` in `@complex-patient/ui`
  - Consent checkbox, password validation, export orchestration
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 6. Wire navigation and routes
  - Home nav entry; mobile + web `(home)/export.tsx` with save adapters
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 7. Mark tasks complete and run `yarn test` in `expo/`
  - _Requirements: all_

## v2

- [x] 8. Add export safety helpers and property tests
  - `validate.ts`, `clinical-export.property.test.ts`, partition/validate tests
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 9. Implement unpack + import preview in `@complex-patient/clinical-export`
  - `unpack.ts`, `import-preview.ts`, round-trip tests
  - _Requirements: 6.1, 6.3_

- [x] 10. Add `ImportScreen` and web import route
  - Preview-only UI; mobile stub until document picker
  - _Requirements: 6.1, 6.2, 8.3_

- [x] 11. v2.1 — merge imported FHIR into Local_Vault partitions
  - `import-parse.ts`, `import-merge.ts`, domain-v1 extensions, merge UI
  - _Requirements: v2.1_

- [x] 12. v2.2 — mobile document picker + native export share
  - `clinical-export-adapters.ts`, expo-document-picker/file-system/sharing
  - _Requirements: 8.3, mobile parity_
