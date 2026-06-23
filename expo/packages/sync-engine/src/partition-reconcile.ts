/**
 * Merge-aware reconciliation of a local partition against a remote vault blob.
 *
 * Used when pulling newer server state so unsynced local records are merged
 * instead of overwritten. Push-side 409 conflicts use the same merge primitive
 * via {@link createConflictResolver}.
 */

import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { VaultBlob } from '@complex-patient/local-vault';
import type { CryptoKeyRef, EncryptedPayload } from '@complex-patient/crypto-engine';
import { threeWayMerge, recordsSetsEqual } from './merge';
import { decryptPartitionRecords, toEncryptedPayload, type VaultBlobCrypto } from './vault-blob-records';

/** Local vault slice required for partition reconciliation. */
export interface ReconcileVault {
  readPartition(vaultType: VaultType): Promise<VaultBlob | null>;
  writePartition(vaultType: VaultType, blob: VaultBlob): Promise<void>;
  readBase(vaultType: VaultType): Promise<VaultBlob | null>;
  setBase(vaultType: VaultType, blob: VaultBlob): Promise<void>;
}

export interface ReconcileCrypto extends VaultBlobCrypto {
  encrypt(plaintext: Uint8Array, kek: CryptoKeyRef): Promise<EncryptedPayload>;
}

export type ReconcilePartitionFailureReason =
  | 'LOCAL_DECRYPT_FAILED'
  | 'REMOTE_DECRYPT_FAILED'
  | 'ENCRYPT_FAILED';

export type ReconcilePartitionOutcome =
  | { status: 'unchanged' }
  | { status: 'applied'; syncVersion: number; needsPush: boolean }
  | { status: 'failed'; reason: ReconcilePartitionFailureReason };

function blobsEqual(a: VaultBlob, b: VaultBlob): boolean {
  return (
    a.sync_version === b.sync_version &&
    a.iv === b.iv &&
    a.auth_tag === b.auth_tag &&
    a.ciphertext === b.ciphertext
  );
}

/**
 * Reconcile the local partition against `remoteBlob` using three-way merge.
 *
 * - No local blob → adopt remote.
 * - Local version ahead of remote → leave unchanged (push will catch up).
 * - Equal version, different ciphertext → local has unpushed edits; leave unchanged.
 * - Remote version ahead → merge(base, local, remote), persist merged locally at
 *   the remote version token, set base to the server's blob, and report whether
 *   a push is still required to publish merged changes.
 */
export async function reconcilePartitionWithRemote(
  vaultType: VaultType,
  remoteBlob: VaultBlob,
  deps: {
    vault: ReconcileVault;
    crypto: ReconcileCrypto;
    kek: CryptoKeyRef;
  },
): Promise<ReconcilePartitionOutcome> {
  const localBlob = await deps.vault.readPartition(vaultType);

  if (localBlob === null) {
    await deps.vault.writePartition(vaultType, remoteBlob);
    await deps.vault.setBase(vaultType, remoteBlob);
    return { status: 'applied', syncVersion: remoteBlob.sync_version, needsPush: false };
  }

  if (localBlob.sync_version > remoteBlob.sync_version) {
    return { status: 'unchanged' };
  }

  if (localBlob.sync_version === remoteBlob.sync_version) {
    if (blobsEqual(localBlob, remoteBlob)) {
      return { status: 'unchanged' };
    }
    // Same optimistic-concurrency token but divergent ciphertext: local edits
    // not yet accepted by the server. Pushing handles this; do not pull-overwrite.
    return { status: 'unchanged' };
  }

  const localRecords = await decryptPartitionRecords(
    toEncryptedPayload(localBlob),
    deps.crypto,
    deps.kek,
  );
  if (localRecords === null) {
    return { status: 'failed', reason: 'LOCAL_DECRYPT_FAILED' };
  }

  const remoteRecords = await decryptPartitionRecords(
    toEncryptedPayload(remoteBlob),
    deps.crypto,
    deps.kek,
  );
  if (remoteRecords === null) {
    return { status: 'failed', reason: 'REMOTE_DECRYPT_FAILED' };
  }

  const baseBlob = await deps.vault.readBase(vaultType);
  let baseRecords: VaultRecord[] = [];
  if (baseBlob !== null) {
    const decodedBase = await decryptPartitionRecords(
      toEncryptedPayload(baseBlob),
      deps.crypto,
      deps.kek,
    );
    baseRecords = decodedBase ?? [];
  }

  const merged = threeWayMerge(baseRecords, localRecords, remoteRecords);

  let encrypted: EncryptedPayload;
  try {
    const plaintext = new TextEncoder().encode(JSON.stringify({ records: merged }));
    encrypted = await deps.crypto.encrypt(plaintext, deps.kek);
  } catch {
    return { status: 'failed', reason: 'ENCRYPT_FAILED' };
  }

  const mergedBlob: VaultBlob = {
    sync_version: remoteBlob.sync_version,
    iv: encrypted.iv,
    auth_tag: encrypted.authTag,
    ciphertext: encrypted.ciphertext,
  };

  await deps.vault.writePartition(vaultType, mergedBlob);
  await deps.vault.setBase(vaultType, remoteBlob);

  const needsPush = !recordsSetsEqual(merged, remoteRecords);
  return { status: 'applied', syncVersion: remoteBlob.sync_version, needsPush };
}
