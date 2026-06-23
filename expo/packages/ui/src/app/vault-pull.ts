/**
 * @complex-patient/ui — Pull remote vault partitions before hydrate
 *
 * Downloads blind encrypted blobs from the Sync_Backend into the Local_Vault
 * so a new device can decrypt data encrypted on another device once the shared
 * KDF material yields the same KEK.
 *
 * When {@link PullRemoteVaultPartitionsOptions.verifyDecrypt} is supplied, pulls
 * use three-way merge instead of blind overwrite so unsynced local records are
 * preserved when the server has moved forward on another device.
 */

import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { VaultType } from '@complex-patient/domain';
import type { LocalVault } from '@complex-patient/local-vault';
import {
  reconcilePartitionWithRemote,
  type ReconcilePartitionOutcome,
} from '@complex-patient/sync-engine';
import type { VaultHttpClient, VaultGetResponse } from '@complex-patient/sync-engine';
import { PHI_VAULT_TYPES } from '../store/types';
import type { VaultBlobLike, VaultStoreCrypto } from '../store/types';

type CompleteVaultGetResponse = VaultGetResponse & {
  sync_version: number;
  iv: string;
  auth_tag: string;
  ciphertext: string;
};

export interface PullPartitionApplied {
  vaultType: VaultType;
  outcome: Extract<ReconcilePartitionOutcome, { status: 'applied' }>;
}

export interface PullRemoteVaultPartitionsOptions {
  vault: LocalVault;
  http: VaultHttpClient;
  /** When true, never overwrite an existing local partition (safe unlock path). */
  onlyIfLocalMissing?: boolean;
  /** Require remote blobs to decrypt with this KEK before writing locally. */
  verifyDecrypt?: {
    kek: CryptoKeyRef;
    crypto: Pick<VaultStoreCrypto, 'decrypt' | 'encrypt'>;
  };
  /** Invoked after a partition is merged or adopted from the server. */
  onPartitionApplied?: (applied: PullPartitionApplied) => void | Promise<void>;
}

function isCompleteBlob(response: VaultGetResponse): response is CompleteVaultGetResponse {
  return (
    response.status >= 200 &&
    response.status < 300 &&
    typeof response.sync_version === 'number' &&
    typeof response.iv === 'string' &&
    typeof response.auth_tag === 'string' &&
    typeof response.ciphertext === 'string'
  );
}

export async function vaultBlobDecrypts(
  blob: VaultBlobLike,
  kek: CryptoKeyRef,
  crypto: Pick<VaultStoreCrypto, 'decrypt'>,
): Promise<boolean> {
  const result = await crypto.decrypt(
    { iv: blob.iv, authTag: blob.auth_tag, ciphertext: blob.ciphertext },
    kek,
  );
  return result.ok;
}

/**
 * Returns whether `kek` decrypts any remote PHI partition. When the server has
 * no vault blobs yet, returns true so first-time unlock is not blocked.
 */
export async function probeRemoteVaultDecrypt(
  http: VaultHttpClient,
  kek: CryptoKeyRef,
  crypto: Pick<VaultStoreCrypto, 'decrypt'>,
): Promise<boolean> {
  const counts = await countVaultBlobsForKek({ http, kek, crypto });
  return counts.total === 0 || counts.decryptable === counts.total;
}

export interface ProbeKekAgainstVaultDataOptions {
  vault?: LocalVault;
  http?: VaultHttpClient;
  kek: CryptoKeyRef;
  crypto: Pick<VaultStoreCrypto, 'decrypt'>;
}

/**
 * True when `kek` decrypts every local and remote PHI blob that exists.
 * Used during unlock so a server-only KDF candidate cannot be chosen when
 * on-device partitions were encrypted with a different salt.
 */
export async function probeKekAgainstVaultData(
  options: ProbeKekAgainstVaultDataOptions,
): Promise<boolean> {
  const counts = await countVaultBlobsForKek(options);
  return counts.total === 0 || counts.decryptable === counts.total;
}

async function countVaultBlobsForKek(
  options: ProbeKekAgainstVaultDataOptions,
): Promise<{ total: number; decryptable: number }> {
  const { vault, http, kek, crypto } = options;
  let total = 0;
  let decryptable = 0;

  if (vault) {
    for (const vaultType of PHI_VAULT_TYPES) {
      const local = await vault.readPartition(vaultType);
      if (local === null) {
        continue;
      }
      total += 1;
      if (await vaultBlobDecrypts(local, kek, crypto)) {
        decryptable += 1;
      }
    }
  }

  const getVault = http?.getVault;
  if (getVault) {
    for (const vaultType of PHI_VAULT_TYPES) {
      let response: VaultGetResponse;
      try {
        response = await getVault(vaultType);
      } catch {
        continue;
      }

      if (response.status === 404 || !isCompleteBlob(response)) {
        continue;
      }

      const remote: VaultBlobLike = {
        sync_version: response.sync_version,
        iv: response.iv,
        auth_tag: response.auth_tag,
        ciphertext: response.ciphertext,
      };
      total += 1;
      if (await vaultBlobDecrypts(remote, kek, crypto)) {
        decryptable += 1;
      }
    }
  }

  return { total, decryptable };
}

async function adoptRemoteBlob(
  vault: LocalVault,
  vaultType: VaultType,
  remote: VaultBlobLike,
  onPartitionApplied?: PullRemoteVaultPartitionsOptions['onPartitionApplied'],
): Promise<void> {
  await vault.writePartition(vaultType, remote);
  await vault.setBase(vaultType, remote);
  await onPartitionApplied?.({
    vaultType,
    outcome: { status: 'applied', syncVersion: remote.sync_version, needsPush: false },
  });
}

/**
 * Fetch every PHI partition from the Sync_Backend and persist blobs that are
 * absent locally or newer on the server.
 */
export async function pullRemoteVaultPartitions(
  options: PullRemoteVaultPartitionsOptions,
): Promise<void> {
  const { vault, http, onlyIfLocalMissing = false, verifyDecrypt, onPartitionApplied } = options;
  const getVault = http.getVault;
  if (!getVault) {
    return;
  }

  for (const vaultType of PHI_VAULT_TYPES) {
    let response: VaultGetResponse;
    try {
      response = await getVault(vaultType);
    } catch {
      continue;
    }

    if (response.status === 404 || !isCompleteBlob(response)) {
      continue;
    }

    const remote: VaultBlobLike = {
      sync_version: response.sync_version,
      iv: response.iv,
      auth_tag: response.auth_tag,
      ciphertext: response.ciphertext,
    };

    const local = await vault.readPartition(vaultType);
    if (local !== null && onlyIfLocalMissing) {
      if (verifyDecrypt) {
        const localDecrypts = await vaultBlobDecrypts(
          local,
          verifyDecrypt.kek,
          verifyDecrypt.crypto,
        );
        if (localDecrypts) {
          continue;
        }
        // Local blob is unreadable with the current KEK — replace with remote.
        const remoteDecrypts = await vaultBlobDecrypts(
          remote,
          verifyDecrypt.kek,
          verifyDecrypt.crypto,
        );
        if (!remoteDecrypts) {
          console.warn(
            `[VaultPull] skipping ${vaultType}: remote blob does not decrypt with the current key`,
          );
          continue;
        }
        await adoptRemoteBlob(vault, vaultType, remote, onPartitionApplied);
        continue;
      }
      continue;
    }

    if (verifyDecrypt) {
      const remoteDecrypts = await vaultBlobDecrypts(remote, verifyDecrypt.kek, verifyDecrypt.crypto);
      if (!remoteDecrypts) {
        console.warn(
          `[VaultPull] skipping ${vaultType}: remote blob does not decrypt with the current key`,
        );
        continue;
      }

      const reconcileOutcome = await reconcilePartitionWithRemote(vaultType, remote, {
        vault,
        crypto: verifyDecrypt.crypto,
        kek: verifyDecrypt.kek,
      });

      if (reconcileOutcome.status === 'applied') {
        await onPartitionApplied?.({ vaultType, outcome: reconcileOutcome });
      } else if (reconcileOutcome.status === 'failed') {
        console.warn(
          `[VaultPull] skipping ${vaultType}: reconcile failed (${reconcileOutcome.reason})`,
        );
      }
      continue;
    }

    if (local !== null && remote.sync_version <= local.sync_version) {
      continue;
    }

    await adoptRemoteBlob(vault, vaultType, remote, onPartitionApplied);
  }
}

/**
 * Replace local partitions with remote copies that decrypt under the current KEK.
 * Used to recover from a prior bad overwrite during unlock.
 */
export async function recoverVaultPartitionsFromRemote(
  options: PullRemoteVaultPartitionsOptions,
): Promise<void> {
  const { vault, http, verifyDecrypt } = options;
  if (!verifyDecrypt) {
    return;
  }

  const getVault = http.getVault;
  if (!getVault) {
    return;
  }

  for (const vaultType of PHI_VAULT_TYPES) {
    let response: VaultGetResponse;
    try {
      response = await getVault(vaultType);
    } catch {
      continue;
    }

    if (response.status === 404 || !isCompleteBlob(response)) {
      continue;
    }

    const remote: VaultBlobLike = {
      sync_version: response.sync_version,
      iv: response.iv,
      auth_tag: response.auth_tag,
      ciphertext: response.ciphertext,
    };

    const decryptOk = await vaultBlobDecrypts(remote, verifyDecrypt.kek, verifyDecrypt.crypto);
    if (!decryptOk) {
      continue;
    }

    await vault.writePartition(vaultType, remote);
  }
}

/** Parse the vault partition name from a hydrate failure message. */
export function parseHydrateFailurePartition(message: string): string | null {
  const match = message.match(/failed to decrypt ([a-zA-Z]+) partition:/);
  return match?.[1] ?? null;
}
