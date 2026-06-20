# Design Document

## Overview

Clinical export is a new headless package `@complex-patient/clinical-export` plus a shared `ExportScreen` in `@complex-patient/ui`. The screen gathers consent and a zip password, reads decrypted partitions through `HomeEntryController.read`, builds a FHIR R4 `Bundle`, and packs it into an AES-256 encrypted ZIP. Platform routes handle download (web) or share/save (mobile).

```
HomeScreen → ExportScreen → clinical-export
                ↑ home.read (5 partitions)
                ↓ Uint8Array zip bytes
         route saveExport adapter
```

## Package: `@complex-patient/clinical-export`

| Module | Responsibility |
|--------|----------------|
| `types.ts` | `ClinicalExportSource`, result types |
| `partition.ts` | Split medications partition into profiles vs PRN logs |
| `fhir.ts` | `buildFhirBundle(source)` → FHIR R4 Bundle |
| `serialize.ts` | Stable JSON serialization |
| `pack.ts` | `packExportZip({ json, zipPassword })` via `@zip.js/zip.js` |
| `export.ts` | `createClinicalExport(source, password)` orchestrator |

### FHIR mapping

| Domain record | FHIR resource | Notes |
|---------------|---------------|-------|
| (synthetic) | `Patient` | Anonymous placeholder `patient-1` |
| `MedicationProfile` | `MedicationStatement` | `medicationCodeableConcept.text` = drugName; dosage in `dosage` |
| `Condition` | `Condition` | `code.text` = name |
| `SymptomEntry` | `Observation` | category symptom; severity as `valueInteger`; duration in `note` |
| `FlareUp` | `Encounter` | `reasonCode` text = trigger; links symptoms via extensions |
| `PrnLog` | `MedicationAdministration` | Links to medication by internal reference |
| (export meta) | `Provenance` | On-device export activity, no network |

Bundle type: `collection`. Each entry includes `fullUrl` (`urn:uuid:…`) derived deterministically from record id for stable references.

### Excluded fields

Strip `deleted` tombstones from export. Omit `op_timestamp` from FHIR bodies except where mapped to `meta.lastUpdated` when useful. Never emit partition envelopes, blob headers, or crypto material.

### ZIP

- Library: `@zip.js/zip.js` (pure JS, works in Node tests, RN, and web).
- File: `complex-patient-export.fhir.json`
- Encryption: `encryptionStrength: 3` (AES-256)
- Output filename: `complex-patient-export.zip`

## UI: `ExportScreen`

States: idle → validating → exporting → ready | error.

Controls:
- Consent checkbox (required)
- Zip password + confirm (secure text)
- Export button
- Back button

Props:
```typescript
interface ExportScreenProps {
  onBack: () => void;
  onSaveExport: (bytes: Uint8Array, filename: string) => Promise<void>;
}
```

Data load: single effect reads all five vault types; filters `deleted !== true`.

## Routes

- `apps/mobile/app/(home)/export.tsx`
- `apps/web/app/(home)/export.tsx`

Web `onSaveExport`: Blob + temporary `<a download>`. Mobile: base64 write via injected adapter (future: expo-file-system + sharing).

## Testing

- Unit: FHIR bundle structure, deleted records excluded, no forbidden keys in JSON string
- Unit: ZIP round-trip with password in Node (zip.js reader)
- Property: `assertNoVaultArtifacts`, resource-id bijection, export→unpack round-trip (`clinical-export.property.test.ts`)
- Unit: partition split, validate export/import passwords, import preview

## v2 Additions

| Module | Responsibility |
|--------|----------------|
| `validate.ts` | Forbidden-token scan, password validation, expected/collected resource ids |
| `unpack.ts` | `unpackExportZip` — decrypt zip and parse FHIR JSON |
| `import-preview.ts` | `buildImportPreview`, `previewClinicalImport` |
| `ImportScreen` | Web file picker + password + preview summary (no vault merge yet) |

### v2.1 (implemented)

- FHIR → domain mapping via `domain-v1` extensions (+ legacy FHIR field fallback)
- `parseFhirBundleToSource`, `prepareClinicalImportMerge`, merge-by-id policy
- ImportScreen merge consent + `home.commit` across all five partitions

### v2.2 (implemented)

- Mobile document picker (`expo-document-picker`) and native export share (`expo-file-system` + `expo-sharing`)
- `applyClinicalImportMerge` orchestrator with commit-order tests
- Mobile adapters isolated under `apps/mobile/src/adapters/`

### v2.3 (planned)

- Optional FHIR XML / C-CDA emit path

## Security notes

Export is intentional plaintext inside the zip (after password). Consent copy must not imply zero-knowledge protection for exported files. Zip password is user-chosen transport protection only; no recovery if forgotten.
