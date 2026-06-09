/**
 * @complex-patient/ui — Offline-first read/write wiring + Sync_Worker binding
 *
 * Task 15.2 wires the universal client's offline-first paths together
 * (design.md → Read and Write Paths):
 *
 * - **Read path (never blocks on network, Requirement 5.2):** UI reads come
 *   exclusively from the {@link VaultStore} projection, which mirrors the
 *   decrypted Local_Vault. The coordinator exposes a thin `read` passthrough so
 *   call sites have a single, obviously-local read API and never reach for the
 *   network on a read.
 *
 * - **Write path (local-first, then async sync, Requirements 5.3–5.6):** a
 *   create/update/delete is routed through the subsystem engine's `mutator`,
 *   then `store.commit` performs encrypt → atomic Local_Vault persist → confirm.
 *   ONLY after the local persist is confirmed does the coordinator enqueue the
 *   partition for synchronization and kick a background sync pass. The commit
 *   resolves as soon as the local write is durable — it never blocks on the
 *   Sync_Backend (Requirements 5.4, 5.2).
 *
 * - **Sync indications (Requirements 5.6, 5.8, 8):** the coordinator tracks a
 *   per-partition {@link PartitionSyncStatus} and notifies subscribers, so the
 *   UI can surface "syncing", "sync pending", and "conflict" badges. Pending is
 *   raised after the Sync_Worker exhausts its retry budget (5.8); conflict is
 *   raised when the 409 three-way-merge cycle cannot complete (8.9).
 *
 * - **Offline always enabled (Requirement 5.5):** there is no flag, option, or
 *   constructor parameter to disable offline operation. The write path ALWAYS
 *   persists locally first and ALWAYS allows CRUD regardless of connectivity;
 *   synchronization is a background concern layered on top, never a gate in
 *   front of local writes.
 */

import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { SyncOutcome } from '@complex-patient/sync-engine';
import { createStore, type StoreApi } from './vanilla-store';
import { PHI_VAULT_TYPES, type PartitionProjection } from './types';
import type { CommitResult, VaultStore } from './vault-store';

/**
 * The synchronization state of a single partition, surfaced to the UI.
 *
 * - `idle`: no unsynced local changes; the partition is in sync (or untouched).
 * - `syncing`: a background sync pass is in flight for this partition.
 * - `pending`: synchronization failed after the retry budget; the local blob is
 *   retained unchanged and a "sync pending" indication is shown (Requirement 5.8).
 * - `conflict`: an HTTP 409 three-way-merge cycle could not be completed; local
 *   records are retained unchanged and a conflict indication is shown (8.9).
 */
export type PartitionSyncStatus = 'idle' | 'syncing' | 'pending' | 'conflict';

/** The reactive sync-status map mirrored to the UI, keyed by vault_type. */
export interface SyncStatusState {
  partitions: Record<VaultType, PartitionSyncStatus>;
}

/**
 * The slice of the Sync_Worker the coordinator drives. Structurally matches
 * `@complex-patient/sync-engine` `SyncWorker` so the concrete worker is
 * assignable without a hard class coupling, keeping the wiring testable under
 * vitest with a fake worker.
 */
export interface SyncWorkerLike {
  /** Record that a partition has unsynced local changes (Requirement 5.6). */
  enqueue(vaultType: VaultType): void;
  /** Push a single partition, returning the outcome (Requirements 5.8, 8). */
  syncPartition(vaultType: VaultType): Promise<SyncOutcome>;
  /** Begin syncing queued partitions within 30s of connectivity (5.7). */
  onConnectivityRestored(): void;
}

/** Dependencies for {@link createOfflineSyncCoordinator}. */
export interface OfflineSyncCoordinatorDeps {
  /** The vault store mirroring decrypted partitions (task 15.1). */
  store: VaultStore;
  /** The background Sync_Worker bridging the Local_Vault and Sync_Backend. */
  syncWorker: SyncWorkerLike;
}

/**
 * The offline-first coordinator handle.
 */
export interface OfflineSyncCoordinator {
  /** Reactive sync-status store; subscribe to drive UI badges. */
  readonly syncStatus: StoreApi<SyncStatusState>;

  /**
   * Read a partition projection from the in-memory mirror of the Local_Vault.
   * This NEVER touches the network and NEVER blocks on a Sync_Backend response
   * (Requirement 5.2).
   */
  read<T extends VaultRecord>(vaultType: VaultType): PartitionProjection & { records: T[] };

  /**
   * Commit a create/update/delete through the offline-first write path:
   * route the change through the `mutator`, encrypt + atomically persist to the
   * Local_Vault, confirm, and only then enqueue + kick a background sync
   * (Requirements 5.3, 5.4, 5.6). Resolves as soon as the LOCAL write is durable
   * — it does not await the network (Requirement 5.2).
   */
  commit<T extends VaultRecord>(
    vaultType: VaultType,
    mutator: (current: T[]) => T[],
  ): Promise<CommitResult<T>>;

  /**
   * Force a background sync pass for a partition and update its status. Returns
   * the worker's outcome. Exposed for connectivity handlers and tests; normal
   * writes trigger this automatically through {@link OfflineSyncCoordinator.commit}.
   */
  syncNow(vaultType: VaultType): Promise<SyncOutcome>;

  /**
   * Notify the coordinator that connectivity has been restored so the worker
   * begins syncing queued partitions within 30 seconds (Requirement 5.7).
   */
  onConnectivityRestored(): void;

  /** Current sync status for a partition. */
  getSyncStatus(vaultType: VaultType): PartitionSyncStatus;

  /** Reset every partition's sync status to `idle` (e.g. on lock). */
  resetSyncStatus(): void;

  /**
   * Detach the coordinator's internal subscriptions (e.g. the lock-driven
   * sync-status reset). Call when tearing the coordinator down.
   */
  dispose(): void;
}

/** Build the all-idle initial sync-status map. */
function initialSyncStatus(): SyncStatusState {
  const partitions = {} as Record<VaultType, PartitionSyncStatus>;
  for (const vaultType of PHI_VAULT_TYPES) {
    partitions[vaultType] = 'idle';
  }
  return { partitions };
}

/** Map a {@link SyncOutcome} to the user-facing {@link PartitionSyncStatus}. */
function statusForOutcome(outcome: SyncOutcome): PartitionSyncStatus {
  switch (outcome.status) {
    case 'synced':
    case 'conflict-resolved':
      return 'idle';
    case 'pending':
      return 'pending';
    case 'conflict-failed':
      return 'conflict';
    default:
      return 'idle';
  }
}

/**
 * Create the offline-first coordinator. It owns no PHI and no key material: it
 * composes the {@link VaultStore} (which holds the decrypted projections behind
 * a private KEK) with the {@link SyncWorkerLike} background worker.
 */
export function createOfflineSyncCoordinator(
  deps: OfflineSyncCoordinatorDeps,
): OfflineSyncCoordinator {
  const { store, syncWorker } = deps;
  const syncStatus = createStore<SyncStatusState>(() => initialSyncStatus());

  function setStatus(vaultType: VaultType, status: PartitionSyncStatus): void {
    if (syncStatus.getState().partitions[vaultType] === status) {
      return;
    }
    syncStatus.setState((state) => ({
      partitions: { ...state.partitions, [vaultType]: status },
    }));
  }

  function read<T extends VaultRecord>(
    vaultType: VaultType,
  ): PartitionProjection & { records: T[] } {
    // Local-only read from the mirror; no network involvement (Requirement 5.2).
    return store.getPartition<T>(vaultType);
  }

  async function syncNow(vaultType: VaultType): Promise<SyncOutcome> {
    setStatus(vaultType, 'syncing');
    let outcome: SyncOutcome;
    try {
      outcome = await syncWorker.syncPartition(vaultType);
    } catch {
      // A worker-level throw is treated like an unresolved sync: the local blob
      // is retained unchanged (the worker never mutates it) and we surface
      // "pending" so the user knows sync is outstanding (Requirement 5.8).
      setStatus(vaultType, 'pending');
      return { status: 'pending', attempts: 0 };
    }
    setStatus(vaultType, statusForOutcome(outcome));
    return outcome;
  }

  async function commit<T extends VaultRecord>(
    vaultType: VaultType,
    mutator: (current: T[]) => T[],
  ): Promise<CommitResult<T>> {
    // Local-first: encrypt → atomic persist → confirm. This resolves without
    // any network round-trip (Requirements 5.3, 5.4).
    const result = await store.commit<T>(vaultType, mutator);
    if (!result.ok) {
      // A failed local persist never enqueues a sync; the store left the
      // projection unchanged so there is nothing new to push (Requirement 5.1).
      return result;
    }

    // Confirmed locally → enqueue the partition and kick a background sync pass.
    // The sync is intentionally NOT awaited so the write path never blocks on
    // the Sync_Backend (Requirement 5.2). Outcomes flow to the sync-status store.
    syncWorker.enqueue(vaultType);
    void syncNow(vaultType);

    return result;
  }

  function onConnectivityRestored(): void {
    syncWorker.onConnectivityRestored();
  }

  function getSyncStatus(vaultType: VaultType): PartitionSyncStatus {
    return syncStatus.getState().partitions[vaultType];
  }

  function resetSyncStatus(): void {
    syncStatus.setState(initialSyncStatus(), true);
  }

  // When the vault locks (explicit lock or the 300s idle timeout clears the
  // store), drop every sync badge back to idle so a stale "pending"/"conflict"
  // indication from the previous session cannot survive into the next unlock
  // (Requirements 3.6, 3.7). The store sets status to 'locked' on clear().
  let wasUnlocked = store.getState().status === 'unlocked';
  const unsubscribe = store.subscribe((state) => {
    const isUnlocked = state.status === 'unlocked';
    if (wasUnlocked && !isUnlocked) {
      resetSyncStatus();
    }
    wasUnlocked = isUnlocked;
  });

  function dispose(): void {
    unsubscribe();
  }

  return {
    syncStatus,
    read,
    commit,
    syncNow,
    onConnectivityRestored,
    getSyncStatus,
    resetSyncStatus,
    dispose,
  };
}
