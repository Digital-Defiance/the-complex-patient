/**
 * Import preview for unpacked clinical export bundles.
 *
 * v2: read-only summary before vault merge (merge itself is a later task).
 */

import { unpackExportZip } from './unpack';
import type { FhirBundle } from './types';

import {
  ASSOCIATION_PROVENANCE_CODE,
  EXPORT_PROVENANCE_CODE,
} from './constants';

export interface ImportPreview {
  exportedAt: string | null;
  isComplexPatientExport: boolean;
  resourceCounts: Record<string, number>;
  totalResources: number;
}

export type ImportPreviewResult =
  | { status: 'ok'; preview: ImportPreview }
  | { status: 'error'; message: string };

function resourceTypeOf(entry: FhirBundle['entry'][number]): string {
  const type = entry.resource.resourceType;
  return typeof type === 'string' ? type : 'Unknown';
}

/**
 * Summarize a FHIR bundle for import preview UI.
 */
export function buildImportPreview(bundle: FhirBundle): ImportPreviewResult {
  if (bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
    return { status: 'error', message: 'Invalid FHIR Bundle.' };
  }

  const resourceCounts: Record<string, number> = {};
  let isComplexPatientExport = false;

  for (const entry of bundle.entry) {
    const type = resourceTypeOf(entry);
    resourceCounts[type] = (resourceCounts[type] ?? 0) + 1;

    if (type === 'Provenance') {
      const activity = entry.resource.activity as { coding?: Array<{ code?: string }> } | undefined;
      const codes = activity?.coding?.map((coding) => coding.code) ?? [];
      if (codes.includes(EXPORT_PROVENANCE_CODE)) {
        isComplexPatientExport = true;
      }
    }
  }

  return {
    status: 'ok',
    preview: {
      exportedAt: bundle.timestamp ?? null,
      isComplexPatientExport,
      resourceCounts,
      totalResources: bundle.entry.length,
    },
  };
}

/**
 * Unpack a zip and return an import preview summary.
 */
export async function previewClinicalImport(
  zipBytes: Uint8Array,
  zipPassword: string,
): Promise<ImportPreviewResult & { bundle?: FhirBundle; json?: string }> {
  const unpacked = await unpackExportZip({ zipBytes, zipPassword });

  if (unpacked.status === 'error') {
    return unpacked;
  }

  const previewResult = buildImportPreview(unpacked.bundle);
  if (previewResult.status === 'error') {
    return previewResult;
  }

  return {
    ...previewResult,
    bundle: unpacked.bundle,
    json: unpacked.json,
  };
}
