/**
 * @complex-patient/polypharmacy — Medication partition gateway
 *
 * Bridges the decrypted-record world the Polypharmacy_Engine operates in and
 * the encrypted `medications` {@link VaultBlobLike} persisted by the
 * Local_Vault. All ciphertext crosses the trust boundary; the engine works on
 * the decrypted {@link MedicationProfile} records only (Requirements 10.3,
 * 10.4, 5.1).
 *
 * The codec is provider-independent: it serializes the partition payload to
 * JSON, encrypts via the injected {@link VaultCrypto}, and persists only the
 * four-field envelope. On read it decrypts and parses back to records.
 */

import type { MedicationProfile, PrnLog } from '@complex-patient/domain';
import type { CryptoKeyRef, EncryptedPayload } from '@complex-patient/crypto-engine';
import type { MedicationVaultStore, VaultBlobLike, VaultCrypto } from './types';

/**
 * The decrypted payload of the `medications` partition.
 *
 * Per the design, the `medications` vault_type carries medication profiles
 * *and* PRN logs (Requirement 13.5, 13.6). Both record lists live in the same
 * encrypted blob so a single optimistic-concurrency token (`sync_version`)
 * governs them together. `prnLogs` is optional on the wire so blobs written by
 * earlier builds (profiles only) still decode.
 */
export interface MedicationPartitionPayload {
  records: MedicationProfile[];
  prnLogs?: PrnLog[];
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** Map the crypto `EncryptedPayload` (authTag) to the vault `VaultBlobLike` (auth_tag). */
function toVaultBlob(payload: EncryptedPayload, syncVersion: number): VaultBlobLike {
  return {
    sync_version: syncVersion,
    iv: payload.iv,
    auth_tag: payload.authTag,
    ciphertext: payload.ciphertext,
  };
}

/** Map the vault `VaultBlobLike` back to the crypto `EncryptedPayload` shape. */
function toEncryptedPayload(blob: VaultBlobLike): EncryptedPayload {
  return {
    iv: blob.iv,
    authTag: blob.auth_tag,
    ciphertext: blob.ciphertext,
  };
}

/**
 * The current decrypted state of the medications partition: the record set and
 * the `sync_version` of the blob it came from (so a subsequent write preserves
 * the optimistic-concurrency token).
 */
export interface MedicationPartitionState {
  records: MedicationProfile[];
  prnLogs: PrnLog[];
  syncVersion: number;
}

/**
 * Reads and decrypts the medications partition into a {@link MedicationPartitionState}.
 *
 * Returns an empty record set at `syncVersion` 0 when no partition exists yet —
 * the first write will create it. Throws on decrypt failure so a corrupt or
 * tampered blob never silently yields an empty set that a write could clobber.
 */
export async function readMedicationPartition(
  store: MedicationVaultStore,
  crypto: VaultCrypto,
  kek: CryptoKeyRef,
): Promise<MedicationPartitionState> {
  const blob = await store.readPartition('medications');
  if (blob === null) {
    return { records: [], prnLogs: [], syncVersion: 0 };
  }

  const result = await crypto.decrypt(toEncryptedPayload(blob), kek);
  if (!result.ok) {
    throw new Error(`failed to decrypt medications partition: ${result.error}`);
  }

  const json = utf8Decoder.decode(result.plaintext);
  const parsed = JSON.parse(json) as MedicationPartitionPayload;
  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  const prnLogs = Array.isArray(parsed?.prnLogs) ? parsed.prnLogs : [];
  return { records, prnLogs, syncVersion: blob.sync_version };
}

/**
 * Encrypts and atomically persists the given record set as the medications
 * partition, preserving the supplied `sync_version` (Requirements 10.3, 10.4,
 * 5.4). Only the ciphertext envelope is handed to the store.
 *
 * PRN logs are persisted in the same partition blob (Requirements 13.5, 13.6).
 * When `prnLogs` is omitted an empty list is written so the payload shape is
 * stable.
 */
export async function writeMedicationPartition(
  store: MedicationVaultStore,
  crypto: VaultCrypto,
  kek: CryptoKeyRef,
  records: MedicationProfile[],
  syncVersion: number,
  prnLogs: PrnLog[] = [],
): Promise<void> {
  const payload: MedicationPartitionPayload = { records, prnLogs };
  const plaintext = utf8Encoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.encrypt(plaintext, kek);
  await store.writePartition('medications', toVaultBlob(encrypted, syncVersion));
}
