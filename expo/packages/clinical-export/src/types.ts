/**
 * Clinical export domain types.
 *
 * Requirements: clinical-export 1.1, 1.3
 */

import type {
  Association,
  Condition,
  FlareUp,
  MedicationProfile,
  PrnLog,
  SymptomEntry,
} from '@complex-patient/domain';

/** Decrypted vault records used to build a FHIR export. */
export interface ClinicalExportSource {
  medications: MedicationProfile[];
  prnLogs: PrnLog[];
  symptoms: SymptomEntry[];
  conditions: Condition[];
  flares: FlareUp[];
  associations: Association[];
}

export const EXPORT_JSON_FILENAME = 'complex-patient-export.fhir.json';
export const EXPORT_ZIP_FILENAME = 'complex-patient-export.zip';

export type ClinicalExportResult =
  | {
      status: 'ok';
      bundle: FhirBundle;
      json: string;
      zipBytes: Uint8Array;
      filename: string;
    }
  | { status: 'error'; message: string };

/** Minimal FHIR R4 Bundle shape for export output. */
export interface FhirBundle {
  resourceType: 'Bundle';
  type: 'collection';
  timestamp: string;
  entry: FhirBundleEntry[];
}

export interface FhirBundleEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
}
