/**
 * @complex-patient/ui — Sync_Worker factory with HTTP 409 conflict resolution
 *
 * The Sync_Worker ships with a placeholder conflict resolver that always reports
 * `conflict-failed`. Production entry points must inject the real
 * {@link createConflictResolver} so a version mismatch triggers fetch → merge →
 * re-push instead of surfacing a permanent "Conflict" badge (Requirement 8).
 */

import { encrypt, decrypt, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultType } from '@complex-patient/domain';
import {
  SyncWorker,
  createConflictResolver,
  type ConflictFailureReason,
  type ConflictResolver,
  type VaultHttpClient,
} from '@complex-patient/sync-engine';

/** Minimal surface for reading the active session KEK during a sync pass. */
export interface ActiveKekSource {
  getKek(): CryptoKeyRef | null;
}

export interface CreateSyncWorkerDeps {
  http: VaultHttpClient;
  vault: LocalVault;
  keyStore: ActiveKekSource;
}

function onConflictError(vaultType: VaultType, reason: ConflictFailureReason): void {
  console.warn(`[SyncWorker] conflict resolution failed for ${vaultType}: ${reason}`);
}

/**
 * Build a {@link SyncWorker} wired for automatic three-way merge on HTTP 409.
 * The KEK is read at resolve time so the worker can be constructed before unlock.
 */
export function createSyncWorker(deps: CreateSyncWorkerDeps): SyncWorker {
  const resolveConflict: ConflictResolver = async (vaultType, remoteSyncVersion) => {
    const kek = deps.keyStore.getKek();
    if (kek === null) {
      console.warn(`[SyncWorker] conflict resolution skipped for ${vaultType}: vault locked`);
      return { status: 'conflict-failed' };
    }

    const resolver = createConflictResolver({
      http: deps.http,
      vault: deps.vault,
      crypto: { encrypt, decrypt },
      kek,
      onConflictError,
    });
    return resolver(vaultType, remoteSyncVersion);
  };

  return new SyncWorker({ http: deps.http, vault: deps.vault, resolveConflict });
}
