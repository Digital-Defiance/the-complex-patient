/**
 * Clinical export domain types.
 *
 * Requirements: clinical-export 1.1, 1.3
 */

import type {
  Association,
  Condition,
  FlareUp,
  LocationTrailSample,
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
  /** Optional location trail (not exported to FHIR; preserved on import merge). */
  locationTrail?: LocationTrailSample[];
}

export const EXPORT_JSON_FILENAME = 'complex-patient-export.fhir.json';
export const EXPORT_MARKDOWN_FILENAME = 'complex-patient-clinical-summary.md';
export const EXPORT_ZIP_FILENAME = 'complex-patient-export.zip';

export type ClinicalExportProgressStage =
  | 'building-fhir'
  | 'serializing'
  | 'encrypting'
  | 'saving'
  | 'complete';

export interface ClinicalExportProgress {
  stage: ClinicalExportProgressStage;
  /** Whole-number percent complete, 0–100. */
  percent: number;
  message: string;
}

export type ClinicalExportProgressCallback = (progress: ClinicalExportProgress) => void;

export type ClinicalExportResult =
  | {
      status: 'ok';
      bundle: FhirBundle;
      json: string;
      markdown: string;
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
