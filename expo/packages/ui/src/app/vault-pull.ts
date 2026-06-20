/**
 * @complex-patient/ui — Pull remote vault partitions before hydrate
 *
 * Downloads blind encrypted blobs from the Sync_Backend into the Local_Vault
 * so a new device can decrypt data encrypted on another device once the shared
 * KDF material yields the same KEK.
 */

import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultHttpClient, VaultGetResponse } from '@complex-patient/sync-engine';
import { PHI_VAULT_TYPES } from '../store/types';

type CompleteVaultGetResponse = VaultGetResponse & {
  sync_version: number;
  iv: string;
  auth_tag: string;
  ciphertext: string;
};

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

/**
 * Fetch every PHI partition from the Sync_Backend and persist blobs that are
 * absent locally or newer on the server.
 */
export async function pullRemoteVaultPartitions(deps: {
  vault: LocalVault;
  http: VaultHttpClient;
}): Promise<void> {
  const getVault = deps.http.getVault;
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

    const remote = {
      sync_version: response.sync_version,
      iv: response.iv,
      auth_tag: response.auth_tag,
      ciphertext: response.ciphertext,
    };

    const local = await deps.vault.readPartition(vaultType);
    if (local === null || remote.sync_version > local.sync_version) {
      await deps.vault.writePartition(vaultType, remote);
    }
  }
}
