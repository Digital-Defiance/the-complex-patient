/**
 * Merge imported domain records into existing vault partitions.
 *
 * Policy: merge by record id; incoming wins when local is missing or incoming
 * op_timestamp is newer/equal.
 */

import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { ClinicalExportSource, FhirBundle } from './types';
import type { ParsedClinicalImport } from './import-parse';
import { parseFhirBundleToSource } from './import-parse';
import { parsedImportToVaultRecords } from './import-parse';

export interface MergeStats {
  added: number;
  updated: number;
  skipped: number;
}

export interface PartitionMergeResult<T extends VaultRecord = VaultRecord> {
  records: T[];
  stats: MergeStats;
}

export interface PreparedClinicalImportMerge {
  partitions: Record<VaultType, PartitionMergeResult>;
  totals: MergeStats;
}

function compareTimestamp(incoming: string, existing: string): number {
  return incoming.localeCompare(existing);
}

export function mergeRecordsById<T extends VaultRecord>(
  current: T[],
  incoming: T[],
): PartitionMergeResult<T> {
  const byId = new Map<string, T>(current.map((record) => [record.id, record]));
  const stats: MergeStats = { added: 0, updated: 0, skipped: 0 };

  for (const record of incoming) {
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, record);
      stats.added += 1;
      continue;
    }

    if (compareTimestamp(record.op_timestamp, existing.op_timestamp) >= 0) {
      byId.set(record.id, record);
      stats.updated += 1;
    } else {
      stats.skipped += 1;
    }
  }

  return { records: [...byId.values()], stats };
}

export function prepareClinicalImportMerge(
  parsed: ParsedClinicalImport,
  current: ClinicalExportSource,
): PreparedClinicalImportMerge {
  const incomingByPartition = parsedImportToVaultRecords(parsed);
  const currentByPartition: Record<VaultType, VaultRecord[]> = {
    medications: [...current.medications, ...current.prnLogs],
    symptoms: current.symptoms,
    conditions: current.conditions,
    flares: current.flares,
    associations: current.associations,
    locationTrail: current.locationTrail ?? [],
  };

  const partitions = {} as Record<VaultType, PartitionMergeResult>;
  const totals: MergeStats = { added: 0, updated: 0, skipped: 0 };

  for (const vaultType of Object.keys(currentByPartition) as VaultType[]) {
    const merged = mergeRecordsById(currentByPartition[vaultType], incomingByPartition[vaultType] ?? []);
    partitions[vaultType] = merged;
    totals.added += merged.stats.added;
    totals.updated += merged.stats.updated;
    totals.skipped += merged.stats.skipped;
  }

  return { partitions, totals };
}

export function validateImportMergeConsent(consented: boolean): string | null {
  if (!consented) return 'Confirm that you want to merge imported records into your vault.';
  return null;
}

export type ClinicalImportCommitResult =
  | { ok: true }
  | { ok: false; message: string };

export type ClinicalImportCommitFn = (
  vaultType: VaultType,
  records: VaultRecord[],
) => Promise<ClinicalImportCommitResult>;

export type ApplyClinicalImportMergeResult =
  | { status: 'ok'; totals: MergeStats; warnings: string[] }
  | { status: 'error'; message: string };

/**
 * Parse, prepare, and commit a clinical import merge across all vault partitions.
 */
export async function applyClinicalImportMerge(
  bundle: FhirBundle,
  current: ClinicalExportSource,
  commit: ClinicalImportCommitFn,
): Promise<ApplyClinicalImportMergeResult> {
  const parsed = parseFhirBundleToSource(bundle);
  if (parsed.status === 'error') {
    return parsed;
  }

  const prepared = prepareClinicalImportMerge(parsed.source, current);
  const vaultTypes: VaultType[] = [
    'medications',
    'symptoms',
    'conditions',
    'flares',
    'associations',
    'locationTrail',
  ];

  for (const vaultType of vaultTypes) {
    const nextRecords = prepared.partitions[vaultType].records;
    const result = await commit(vaultType, nextRecords);
    if (!result.ok) {
      return { status: 'error', message: result.message };
    }
  }

  return {
    status: 'ok',
    totals: prepared.totals,
    warnings: parsed.warnings,
  };
}
