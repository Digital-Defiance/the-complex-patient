/**
 * Clinical export orchestrator.
 */

import { buildFhirBundle } from './fhir';
import { packExportZip } from './pack';
import { serializeFhirJson } from './serialize';
import {
  EXPORT_ZIP_FILENAME,
  type ClinicalExportResult,
  type ClinicalExportSource,
} from './types';

export interface CreateClinicalExportOptions {
  source: ClinicalExportSource;
  zipPassword: string;
  exportedAt?: string;
}

/**
 * Build FHIR JSON and pack it into a password-protected ZIP on-device.
 */
export async function createClinicalExport(
  options: CreateClinicalExportOptions,
): Promise<ClinicalExportResult> {
  const { source, zipPassword, exportedAt } = options;

  if (!zipPassword.trim()) {
    return { status: 'error', message: 'Zip password is required.' };
  }

  try {
    const at = exportedAt ?? new Date().toISOString();
    const bundle = buildFhirBundle(source, at);
    const json = serializeFhirJson(bundle);
    const zipBytes = await packExportZip({ json, zipPassword });

    return {
      status: 'ok',
      bundle,
      json,
      zipBytes,
      filename: EXPORT_ZIP_FILENAME,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed.';
    return { status: 'error', message };
  }
}

export { buildFhirBundle } from './fhir';
export { serializeFhirJson } from './serialize';
export { packExportZip } from './pack';
export {
  filterActive,
  isDeleted,
  isMedicationProfile,
  isPrnLog,
  splitMedicationsPartition,
} from './partition';
export {
  assertNoVaultArtifacts,
  collectBundleResourceIds,
  expectedExportResourceIds,
  FORBIDDEN_EXPORT_TOKENS,
  validateExportPasswords,
  validateImportPassword,
} from './validate';
export { unpackExportZip, type UnpackExportZipResult } from './unpack';
export {
  buildImportPreview,
  previewClinicalImport,
  type ImportPreview,
  type ImportPreviewResult,
} from './import-preview';
export {
  parseFhirBundleToSource,
  parsedImportRecordCount,
  parsedImportToVaultRecords,
  type ParsedClinicalImport,
  type ParseFhirBundleResult,
} from './import-parse';
export {
  mergeRecordsById,
  prepareClinicalImportMerge,
  applyClinicalImportMerge,
  validateImportMergeConsent,
  type MergeStats,
  type PartitionMergeResult,
  type PreparedClinicalImportMerge,
  type ClinicalImportCommitFn,
  type ClinicalImportCommitResult,
  type ApplyClinicalImportMergeResult,
} from './import-merge';
export {
  EXPORT_JSON_FILENAME,
  EXPORT_ZIP_FILENAME,
  type ClinicalExportSource,
  type ClinicalExportResult,
  type FhirBundle,
  type FhirBundleEntry,
} from './types';
