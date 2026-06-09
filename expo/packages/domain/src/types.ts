/**
 * Core vault record and partition types.
 *
 * These types define the foundational data structures for the zero-knowledge
 * encrypted vault system. Every domain record extends VaultRecord to gain
 * the merge-resolution fields (id, op_timestamp, deleted).
 *
 * Requirements: 8.5, 8.6, 8.7
 */

/**
 * The logical partitions of encrypted data in the vault.
 * Each partition is the unit of sync and optimistic concurrency.
 */
export type VaultType =
  | 'medications'
  | 'symptoms'
  | 'conditions'
  | 'flares'
  | 'associations';

/**
 * Base interface for all vault records.
 *
 * - `id`: unique record identifier (UUID); used as merge tiebreak key (8.7, 18.3)
 * - `op_timestamp`: ISO 8601 client-side operational timestamp (10.5, 15.2, 8.6)
 * - `deleted`: soft-delete tombstone to preserve deletes across merges
 */
export interface VaultRecord {
  id: string;
  op_timestamp: string;
  deleted?: boolean;
}

/**
 * Envelope carrying the records for a single vault partition.
 * This is the decrypted payload structure that gets encrypted into a Vault_Blob.
 */
export interface PartitionPayload<T extends VaultRecord> {
  records: T[];
}
