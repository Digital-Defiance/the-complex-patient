/**
 * @complex-patient/ui — React reactivity hooks bridging the controller stores
 *
 * These hooks bridge the vanilla subscribe-able stores (StoreApi) exposed by the
 * Home_Controller's offline-sync coordinator into React's concurrent rendering
 * model using `useSyncExternalStore`. This is the idiomatic, tear-free way to
 * read an external store in React 18+ / 19.
 *
 * Key invariants:
 * - All PHI reads go exclusively through `Home_Controller.read` (Requirement 14.1).
 * - Sync-status reads go through the coordinator's `syncStatus` store (Requirement 12.1).
 * - The hooks are tear-free: `useSyncExternalStore` guarantees a consistent
 *   snapshot within a single render pass (Requirement 8.6).
 * - The web snapshot (third argument) is identical to the client snapshot because
 *   the stores are always available (no SSR hydration mismatch concern for this
 *   app, but we satisfy the API contract).
 *
 * Requirements: 8.6, 12.1, 14.1
 */

import { useSyncExternalStore } from 'react';
import type { StoreApi } from '../store/vanilla-store';
import type { PartitionSyncStatus, SyncStatusState } from '../store/offline-sync';
import type { HomeEntryController } from '../app/home-entry';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { PartitionProjection } from '../store/types';

/**
 * Subscribe a component to a vanilla store slice (tear-free).
 *
 * Uses `useSyncExternalStore` to guarantee consistent reads within a React
 * render pass. The store's `subscribe` function is called with a listener that
 * React invokes on state transitions; the snapshot functions return the current
 * selected state.
 *
 * @param store - A vanilla subscribe-able store (StoreApi<T>).
 * @param selector - A pure function selecting a slice of the store state.
 * @returns The selected slice, updated on every store transition.
 */
export function useStore<T, S>(store: StoreApi<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()), // SSR/web snapshot — identical for this app
  );
}

/**
 * Read a PHI partition projection for rendering (local-only).
 *
 * Subscribes to the coordinator's syncStatus store so the component re-renders
 * on any coordinator state transition (including commit confirmations), then
 * reads the current records exclusively through `Home_Controller.read` — never
 * from a private cache or the network (Requirement 14.1, 8.6).
 *
 * When the vault locks, `home.read(...)` returns empty records (the store is
 * cleared on lock), which means no PHI survives a lock event in the rendered
 * output (Requirement 13.5).
 *
 * @param home - The HomeEntryController instance.
 * @param vaultType - The vault partition type to read.
 * @returns The current records array for the partition.
 */
export function usePartition<T extends VaultRecord>(
  home: HomeEntryController,
  vaultType: VaultType,
): T[] {
  // Subscribe to the syncStatus store so we re-render on state transitions
  // (commits, syncs, locks). The selected value itself isn't used directly —
  // it's the subscription that triggers re-reads through home.read.
  useStore(home.coordinator.syncStatus, (s) => s);
  return home.read<T>(vaultType).records;
}

/**
 * Read the sync status for a specific partition.
 *
 * Returns the `PartitionSyncStatus` (idle | syncing | pending | conflict) for
 * the given vault type, updated within one React commit of a coordinator state
 * change — well within the 1-second budget (Requirement 12.1).
 *
 * @param home - The HomeEntryController instance.
 * @param vaultType - The vault partition type to observe.
 * @returns The current sync status for the partition.
 */
export function useSyncStatus(
  home: HomeEntryController,
  vaultType: VaultType,
): PartitionSyncStatus {
  return useStore(home.coordinator.syncStatus, (s) => s.partitions[vaultType]);
}
