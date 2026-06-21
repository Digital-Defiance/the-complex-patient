/**
 * @complex-patient/ui — Pull remote vault partitions before hydrate
 *
 * Downloads blind encrypted blobs from the Sync_Backend into the Local_Vault
 * so a new device can decrypt data encrypted on another device once the shared
 * KDF material yields the same KEK.
 */

import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultHttpClient, VaultGetResponse } from '@complex-patient/sync-engine';
import { PHI_VAULT_TYPES } from '../store/types';
import type { VaultBlobLike, VaultStoreCrypto } from '../store/types';

type CompleteVaultGetResponse = VaultGetResponse & {
  sync_version: number;
  iv: string;
  auth_tag: string;
  ciphertext: string;
};

export interface PullRemoteVaultPartitionsOptions {
  vault: LocalVault;
  http: VaultHttpClient;
  /** When true, never overwrite an existing local partition (safe unlock path). */
  onlyIfLocalMissing?: boolean;
  /** Require remote blobs to decrypt with this KEK before writing locally. */
  verifyDecrypt?: {
    kek: CryptoKeyRef;
    crypto: Pick<VaultStoreCrypto, 'decrypt'>;
  };
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

async function blobDecrypts(
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
 * Fetch every PHI partition from the Sync_Backend and persist blobs that are
 * absent locally or newer on the server.
 */
export async function pullRemoteVaultPartitions(
  options: PullRemoteVaultPartitionsOptions,
): Promise<void> {
  const { vault, http, onlyIfLocalMissing = false, verifyDecrypt } = options;
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
      continue;
    }

    if (local !== null && remote.sync_version <= local.sync_version) {
      continue;
    }

    if (verifyDecrypt) {
      const decryptOk = await blobDecrypts(remote, verifyDecrypt.kek, verifyDecrypt.crypto);
      if (!decryptOk) {
        console.warn(
          `[VaultPull] skipping ${vaultType}: remote blob does not decrypt with the current key`,
        );
        continue;
      }
    }

    await vault.writePartition(vaultType, remote);
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

    const decryptOk = await blobDecrypts(remote, verifyDecrypt.kek, verifyDecrypt.crypto);
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
