/**
 * Clinical export orchestrator.
 */

import { buildFhirBundle } from './fhir';
import { buildClinicalSummaryMarkdown } from './clinical-summary';
import { ExportProgressTracker } from './export-progress';
import { packExportZip } from './pack';
import { serializeFhirJson } from './serialize';
import {
  EXPORT_ZIP_FILENAME,
  type ClinicalExportProgressCallback,
  type ClinicalExportResult,
  type ClinicalExportSource,
} from './types';

export interface CreateClinicalExportOptions {
  source: ClinicalExportSource;
  zipPassword: string;
  exportedAt?: string;
  onProgress?: ClinicalExportProgressCallback;
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Build FHIR JSON and pack it into a password-protected ZIP on-device.
 */
export async function createClinicalExport(
  options: CreateClinicalExportOptions,
): Promise<ClinicalExportResult> {
  const { source, zipPassword, exportedAt, onProgress } = options;

  if (!zipPassword.trim()) {
    return { status: 'error', message: 'Zip password is required.' };
  }

  const tracker = new ExportProgressTracker(onProgress);

  try {
    const at = exportedAt ?? new Date().toISOString();

    tracker.buildStart();
    await yieldToUi();
    const bundle = buildFhirBundle(source, at);
    const markdown = buildClinicalSummaryMarkdown(source, at);
    tracker.buildDone();
    await yieldToUi();

    tracker.serializeStart();
    await yieldToUi();
    const json = serializeFhirJson(bundle);
    tracker.serializeDone();
    await yieldToUi();

    const jsonBytes = new TextEncoder().encode(json).length;
    const markdownBytes = new TextEncoder().encode(markdown).length;
    tracker.encryptStart(jsonBytes + markdownBytes);

    const zipBytes = await packExportZip({
      json,
      markdown,
      zipPassword,
      onPackProgress: (step, message) => tracker.encryptSubstep(step, message),
    });

    tracker.encryptDone();

    return {
      status: 'ok',
      bundle,
      json,
      markdown,
      zipBytes,
      filename: EXPORT_ZIP_FILENAME,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed.';
    return { status: 'error', message };
  } finally {
    tracker.dispose();
  }
}

export { buildFhirBundle } from './fhir';
export { buildClinicalSummaryMarkdown, SEVERE_SYMPTOM_THRESHOLD } from './clinical-summary';
export { serializeFhirJson } from './serialize';
export { packExportZip } from './pack';
export {
  ExportProgressTracker,
  encryptTimeFraction,
  estimateEncryptDurationMs,
  type PackProgressStep,
} from './export-progress';
export {
  filterActive,
  isDeleted,
  isMedicationProfile,
  isMedEvent,
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
  EXPORT_MARKDOWN_FILENAME,
  EXPORT_ZIP_FILENAME,
  type ClinicalExportSource,
  type ClinicalExportResult,
  type ClinicalExportProgress,
  type ClinicalExportProgressCallback,
  type ClinicalExportProgressStage,
  type FhirBundle,
  type FhirBundleEntry,
} from './types';
