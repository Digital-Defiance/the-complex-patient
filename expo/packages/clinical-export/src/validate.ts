/**
 * Export safety checks for serialized FHIR output.
 *
 * Requirements: clinical-export 1.3, v2 property tests
 */

import type { ClinicalExportSource, FhirBundle } from './types';
import { filterActive } from './partition';

/** Substrings that must never appear in exported JSON. */
export const FORBIDDEN_EXPORT_TOKENS = [
  'Vault_Blob',
  'vault_blob',
  'ciphertext',
  'master_passphrase',
  'kek',
  'kdf',
  'op_timestamp',
  'partitionpayload',
  'sync_token',
] as const;

export function assertNoVaultArtifacts(json: string): void {
  const lower = json.toLowerCase();
  for (const token of FORBIDDEN_EXPORT_TOKENS) {
    if (lower.includes(token.toLowerCase())) {
      throw new Error(`Export JSON contains forbidden token: ${token}`);
    }
  }
}

/** Collect resource ids expected in an export bundle for active source records. */
export function expectedExportResourceIds(source: ClinicalExportSource): Set<string> {
  const ids = new Set<string>(['patient-1', 'export-provenance']);

  for (const med of filterActive(source.medications)) ids.add(med.id);
  for (const log of filterActive(source.prnLogs)) ids.add(log.id);
  for (const symptom of filterActive(source.symptoms)) ids.add(symptom.id);
  for (const condition of filterActive(source.conditions)) ids.add(condition.id);
  for (const flare of filterActive(source.flares)) ids.add(flare.id);
  for (const association of filterActive(source.associations)) ids.add(`assoc-${association.id}`);

  return ids;
}

/** Collect resource ids present in a FHIR bundle. */
export function collectBundleResourceIds(bundle: FhirBundle): Set<string> {
  const ids = new Set<string>();
  for (const entry of bundle.entry) {
    const id = entry.resource.id;
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

export function validateExportPasswords(
  consented: boolean,
  zipPassword: string,
  zipPasswordConfirm: string,
): string | null {
  if (!consented) return 'Consent is required before export.';
  if (!zipPassword.trim()) return 'Enter a zip password.';
  if (zipPassword !== zipPasswordConfirm) return 'Zip passwords do not match.';
  return null;
}

export function validateImportPassword(zipPassword: string): string | null {
  if (!zipPassword.trim()) return 'Enter the zip password for this export file.';
  return null;
}
