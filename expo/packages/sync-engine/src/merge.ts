/**
 * Client-side three-way chronological merge for conflict resolution.
 *
 * When a POST is rejected with HTTP 409, the Sync_Worker fetches the latest
 * remote Vault_Blob and reconciles it with the unsynced local records against
 * the last common synced base. This module implements the pure merge function
 * at the heart of that protocol.
 *
 * The merge operates over decrypted partition record sets keyed by `id`:
 * - `base`   — records from the last common synced base.
 * - `local`  — current unsynced local records.
 * - `remote` — records from the fetched conflicting Vault_Blob.
 *
 * Requirements:
 * - 8.5: retain every non-conflicting record present in either local or remote.
 * - 8.6: when two records conflict, prefer the more recent `op_timestamp`.
 * - 8.7: on equal `op_timestamp`, prefer the lexicographically greater `id`.
 *
 * Soft-delete tombstones (records with `deleted === true`) are treated like any
 * other record: they participate in the union and conflict resolution and are
 * carried through into the merged result so deletes are preserved across sync.
 */

import type { VaultRecord } from '@complex-patient/domain';

/**
 * Produce a canonical string representation of a record so that two records can
 * be compared for deep, key-order-independent structural equality.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Deep structural equality for two vault records.
 */
function recordsEqual<T extends VaultRecord>(a: T, b: T): boolean {
  return canonicalize(a) === canonicalize(b);
}

/**
 * Determine whether `current` represents a change relative to `base`.
 * A record with no base counterpart is a new record (changed). A record whose
 * content differs from its base counterpart is an edit (changed).
 */
function isChanged<T extends VaultRecord>(current: T, base: T | undefined): boolean {
  return base === undefined || !recordsEqual(current, base);
}

/**
 * Resolve a true conflict between a local and remote record that share an `id`
 * and have both changed relative to base.
 *
 * Precedence rules (deterministic):
 * 1. More recent `op_timestamp` wins (8.6).
 * 2. On equal `op_timestamp`, the lexicographically greater `id` wins (8.7).
 * 3. On equal `op_timestamp` and equal `id` (same record, divergent content),
 *    fall back to the local record so the function stays a deterministic,
 *    total pure function of its inputs.
 */
function resolveConflict<T extends VaultRecord>(local: T, remote: T): T {
  if (local.op_timestamp > remote.op_timestamp) {
    return local;
  }
  if (remote.op_timestamp > local.op_timestamp) {
    return remote;
  }
  // Equal timestamps: tie-break by lexicographically greater id (8.7).
  if (local.id > remote.id) {
    return local;
  }
  if (remote.id > local.id) {
    return remote;
  }
  // Same id and timestamp: deterministic fallback keeps the result a pure
  // function of its inputs.
  return local;
}

/**
 * Index a record set by `id`. Later occurrences of a duplicate id overwrite
 * earlier ones, mirroring last-write-wins within a single side's set.
 */
function indexById<T extends VaultRecord>(records: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    map.set(record.id, record);
  }
  return map;
}

/**
 * Perform a three-way chronological merge of vault records.
 *
 * @param base   Last common synced base records.
 * @param local  Current unsynced local records.
 * @param remote Fetched conflicting remote records.
 * @returns The merged record set, one record per `id`, ordered by `id`.
 */
export function threeWayMerge<T extends VaultRecord>(
  base: readonly T[],
  local: readonly T[],
  remote: readonly T[],
): T[] {
  const baseMap = indexById(base);
  const localMap = indexById(local);
  const remoteMap = indexById(remote);

  // Union of all ids appearing in local or remote (8.5).
  const ids = new Set<string>();
  for (const id of localMap.keys()) {
    ids.add(id);
  }
  for (const id of remoteMap.keys()) {
    ids.add(id);
  }

  const merged: T[] = [];

  for (const id of ids) {
    const localRec = localMap.get(id);
    const remoteRec = remoteMap.get(id);

    if (localRec !== undefined && remoteRec !== undefined) {
      // Present on both sides.
      if (recordsEqual(localRec, remoteRec)) {
        // Identical content: not a conflict, take either (8.5).
        merged.push(localRec);
        continue;
      }

      const baseRec = baseMap.get(id);
      const localChanged = isChanged(localRec, baseRec);
      const remoteChanged = isChanged(remoteRec, baseRec);

      if (localChanged && !remoteChanged) {
        // One-sided change: only local diverged from base.
        merged.push(localRec);
      } else if (remoteChanged && !localChanged) {
        // One-sided change: only remote diverged from base.
        merged.push(remoteRec);
      } else {
        // Both sides changed and differ: genuine conflict (8.6, 8.7).
        merged.push(resolveConflict(localRec, remoteRec));
      }
    } else if (localRec !== undefined) {
      // Present only locally: keep it (8.5).
      merged.push(localRec);
    } else if (remoteRec !== undefined) {
      // Present only remotely: keep it (8.5).
      merged.push(remoteRec);
    }
  }

  // Deterministic, stable output order keyed by id.
  merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return merged;
}
