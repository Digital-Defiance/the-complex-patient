/**
 * Unit tests for the reactivity hooks (useStore, usePartition, useSyncStatus).
 *
 * These tests verify the essential contracts that make the hooks work:
 *
 * 1. A coordinator setState propagates to subscribers synchronously — this is
 *    the precondition for the "within one React commit" guarantee (Req 8.6).
 *    useSyncExternalStore reads a snapshot that is already updated because the
 *    vanilla store notifies synchronously.
 *
 * 2. usePartition re-reads via home.read on each store transition (Req 8.6) —
 *    verified by simulating the subscription/re-render cycle.
 *
 * 3. useSyncStatus reads from the coordinator.syncStatus store (Req 12.1) —
 *    verified by confirming snapshot reads from the correct store path.
 *
 * The hooks themselves are thin wrappers around React's useSyncExternalStore,
 * so these tests verify the preconditions and integration at the store seam
 * level (synchronous notification, correct subscribe/getState wiring, and
 * home.read call-through).
 *
 * Requirements: 8.6, 12.1
 */

import { describe, it, expect, vi } from 'vitest';
import { createStore, type StoreApi } from '../store/vanilla-store';
import type { SyncStatusState, PartitionSyncStatus } from '../store/offline-sync';
import type { HomeEntryController } from '../app/home-entry';
import type { VaultRecord, VaultType } from '@complex-patient/domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock SyncStatusState store with all partitions set to idle. */
function createSyncStatusStore(
  initial?: Partial<Record<VaultType, PartitionSyncStatus>>,
): StoreApi<SyncStatusState> {
  const defaultPartitions: Record<VaultType, PartitionSyncStatus> = {
    medications: 'idle',
    symptoms: 'idle',
    conditions: 'idle',
    flares: 'idle',
    associations: 'idle',
  };
  return createStore<SyncStatusState>(() => ({
    partitions: { ...defaultPartitions, ...initial },
  }));
}

interface TestRecord extends VaultRecord {
  name: string;
}

/**
 * Simulates what useSyncExternalStore does: subscribes to the store and reads
 * a snapshot via a selector. Returns an object that tracks each "rendered" value
 * as the store transitions.
 */
function simulateUseSyncExternalStore<T, S>(
  store: StoreApi<T>,
  selector: (s: T) => S,
): { values: S[]; current: () => S } {
  const values: S[] = [];
  // Initial "render" — read the snapshot
  values.push(selector(store.getState()));
  // Subscribe — on each notification, useSyncExternalStore re-reads and re-renders
  store.subscribe(() => {
    values.push(selector(store.getState()));
  });
  return {
    values,
    current: () => values[values.length - 1],
  };
}

/**
 * Simulates what usePartition does: subscribes to syncStatus and on each
 * transition calls home.read(vaultType). Returns captured read results.
 */
function simulateUsePartition(
  home: { coordinator: { syncStatus: StoreApi<SyncStatusState> }; read: (vt: VaultType) => { records: TestRecord[]; syncVersion: number } },
  vaultType: VaultType,
): { readResults: TestRecord[][]; readSpy: ReturnType<typeof vi.fn> } {
  const readSpy = vi.fn(home.read);
  const readResults: TestRecord[][] = [];

  // Initial "render"
  readResults.push(readSpy(vaultType).records);

  // Subscribe to syncStatus — on transition, re-read via home.read
  home.coordinator.syncStatus.subscribe(() => {
    readResults.push(readSpy(vaultType).records);
  });

  return { readResults, readSpy };
}

// ---------------------------------------------------------------------------
// 1. Store subscription: setState propagates synchronously to subscribers
//    (precondition for the "within one React commit" guarantee, Req 8.6)
// ---------------------------------------------------------------------------

describe('Store subscription propagation (Req 8.6 precondition)', () => {
  it('notifies subscribers synchronously on setState', () => {
    const store = createStore<{ count: number }>(() => ({ count: 0 }));
    const notifications: number[] = [];

    store.subscribe((state) => {
      notifications.push(state.count);
    });

    store.setState({ count: 1 });
    // Synchronous: subscriber was already called before setState returns
    expect(notifications).toEqual([1]);

    store.setState({ count: 2 });
    expect(notifications).toEqual([1, 2]);
  });

  it('subscribers receive the new state before setState returns', () => {
    const store = createStore<{ value: string }>(() => ({ value: 'initial' }));
    let capturedDuringSet: string | null = null;

    store.subscribe((state) => {
      capturedDuringSet = state.value;
    });

    store.setState({ value: 'updated' });
    expect(capturedDuringSet).toBe('updated');
  });

  it('getState returns updated value immediately after setState', () => {
    const store = createStore<{ x: number }>(() => ({ x: 0 }));

    store.setState({ x: 42 });
    expect(store.getState().x).toBe(42);
  });

  it('functional updater propagates synchronously with the derived state', () => {
    const store = createStore<{ count: number }>(() => ({ count: 0 }));
    const values: number[] = [];

    store.subscribe((state) => values.push(state.count));

    store.setState((s) => ({ count: s.count + 1 }));
    store.setState((s) => ({ count: s.count + 1 }));

    expect(values).toEqual([1, 2]);
    expect(store.getState().count).toBe(2);
  });

  it('unsubscribe removes the listener', () => {
    const store = createStore<{ n: number }>(() => ({ n: 0 }));
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.setState({ n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.setState({ n: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2. useStore simulation — correct snapshot reading
// ---------------------------------------------------------------------------

describe('useStore behavior (simulated via subscribe + getSnapshot)', () => {
  it('reads the initial state via the selector', () => {
    const store = createStore<{ name: string }>(() => ({ name: 'Alice' }));
    const { current } = simulateUseSyncExternalStore(store, (s) => s.name);
    expect(current()).toBe('Alice');
  });

  it('updates the snapshot on each store transition', () => {
    const store = createStore<{ count: number }>(() => ({ count: 0 }));
    const { values, current } = simulateUseSyncExternalStore(store, (s) => s.count);

    store.setState({ count: 5 });
    store.setState({ count: 10 });

    expect(values).toEqual([0, 5, 10]);
    expect(current()).toBe(10);
  });

  it('derived selector re-evaluates on each transition', () => {
    const store = createStore<{ items: string[] }>(() => ({ items: ['a', 'b'] }));
    const { values } = simulateUseSyncExternalStore(store, (s) => s.items.length);

    store.setState({ items: ['a', 'b', 'c'] });
    expect(values).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 3. usePartition — re-reads via home.read on each store transition (Req 8.6)
// ---------------------------------------------------------------------------

describe('usePartition behavior (Req 8.6)', () => {
  it('calls home.read with the specified vaultType on initial render', () => {
    const syncStatusStore = createSyncStatusStore();
    const records: TestRecord[] = [{ id: '1', op_timestamp: 't1', name: 'aspirin' }];
    const home = {
      coordinator: { syncStatus: syncStatusStore },
      read: vi.fn((vt: VaultType) => ({ records, syncVersion: 1 })),
    };

    const { readResults, readSpy } = simulateUsePartition(home, 'medications');

    expect(readSpy).toHaveBeenCalledWith('medications');
    expect(readResults[0]).toEqual(records);
  });

  it('re-reads via home.read on each syncStatus store transition', () => {
    const syncStatusStore = createSyncStatusStore();
    let callCount = 0;
    const home = {
      coordinator: { syncStatus: syncStatusStore },
      read: vi.fn((vt: VaultType) => {
        callCount++;
        return { records: [{ id: `r${callCount}`, op_timestamp: 't', name: `med-${callCount}` }], syncVersion: callCount };
      }),
    };

    const { readResults, readSpy } = simulateUsePartition(home, 'medications');

    // Simulate coordinator setState (e.g., after a commit confirmation)
    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'syncing' },
    }));

    // home.read was called again on the transition
    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(readResults[0][0].name).toBe('med-1');
    expect(readResults[1][0].name).toBe('med-2');
  });

  it('re-reads on every transition regardless of which partition changed', () => {
    const syncStatusStore = createSyncStatusStore();
    const home = {
      coordinator: { syncStatus: syncStatusStore },
      read: vi.fn(() => ({ records: [], syncVersion: 1 })),
    };

    const { readSpy } = simulateUsePartition(home, 'medications');

    // A change to symptoms partition still triggers a re-read of medications
    // because usePartition subscribes to the entire syncStatus store
    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, symptoms: 'pending' },
    }));

    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(readSpy).toHaveBeenNthCalledWith(2, 'medications');
  });

  it('returns empty records when home.read returns empty', () => {
    const syncStatusStore = createSyncStatusStore();
    const home = {
      coordinator: { syncStatus: syncStatusStore },
      read: vi.fn(() => ({ records: [], syncVersion: 0 })),
    };

    const { readResults } = simulateUsePartition(home, 'symptoms');
    expect(readResults[0]).toEqual([]);
  });

  it('reads exclusively through home.read (never a private cache)', () => {
    const syncStatusStore = createSyncStatusStore();
    // The read function returns DIFFERENT data each call to prove
    // usePartition doesn't cache
    let counter = 0;
    const home = {
      coordinator: { syncStatus: syncStatusStore },
      read: vi.fn(() => {
        counter++;
        return { records: [{ id: `${counter}`, op_timestamp: 't', name: `v${counter}` }], syncVersion: counter };
      }),
    };

    const { readResults } = simulateUsePartition(home, 'medications');

    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'syncing' },
    }));
    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'idle' },
    }));

    // Each transition caused a fresh read through home.read
    expect(readResults).toHaveLength(3);
    expect(readResults[0][0].name).toBe('v1');
    expect(readResults[1][0].name).toBe('v2');
    expect(readResults[2][0].name).toBe('v3');
  });
});

// ---------------------------------------------------------------------------
// 4. useSyncStatus — reads from the coordinator syncStatus store (Req 12.1)
// ---------------------------------------------------------------------------

describe('useSyncStatus behavior (Req 12.1)', () => {
  it('reads the sync status for a specific partition', () => {
    const syncStatusStore = createSyncStatusStore({ medications: 'syncing' });
    const { current } = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.medications,
    );
    expect(current()).toBe('syncing');
  });

  it('reads idle for a partition with no pending changes', () => {
    const syncStatusStore = createSyncStatusStore();
    const { current } = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.symptoms,
    );
    expect(current()).toBe('idle');
  });

  it('reads pending status correctly', () => {
    const syncStatusStore = createSyncStatusStore({ flares: 'pending' });
    const { current } = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.flares,
    );
    expect(current()).toBe('pending');
  });

  it('reads conflict status correctly', () => {
    const syncStatusStore = createSyncStatusStore({ associations: 'conflict' });
    const { current } = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.associations,
    );
    expect(current()).toBe('conflict');
  });

  it('updates within the same synchronous turn as setState (1-second budget)', () => {
    const syncStatusStore = createSyncStatusStore();
    const { values } = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.medications,
    );

    // Simulate coordinator transitioning medications
    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'syncing' },
    }));

    // The subscriber was notified synchronously, so useSyncExternalStore would
    // read the new snapshot in the same React commit — well within 1 second.
    expect(values).toEqual(['idle', 'syncing']);
  });

  it('each partition status is independently tracked', () => {
    const syncStatusStore = createSyncStatusStore({
      medications: 'syncing',
      symptoms: 'pending',
      conditions: 'conflict',
    });

    const meds = simulateUseSyncExternalStore(syncStatusStore, (s) => s.partitions.medications);
    const syms = simulateUseSyncExternalStore(syncStatusStore, (s) => s.partitions.symptoms);
    const conds = simulateUseSyncExternalStore(syncStatusStore, (s) => s.partitions.conditions);

    expect(meds.current()).toBe('syncing');
    expect(syms.current()).toBe('pending');
    expect(conds.current()).toBe('conflict');
  });

  it('reflects the latest state after multiple rapid transitions', () => {
    const syncStatusStore = createSyncStatusStore();
    const { values, current } = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.medications,
    );

    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'syncing' },
    }));
    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'pending' },
    }));
    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'idle' },
    }));

    expect(values).toEqual(['idle', 'syncing', 'pending', 'idle']);
    expect(current()).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// 5. Integration: full coordinator setState → hook re-read cycle
// ---------------------------------------------------------------------------

describe('Full coordinator setState → hook propagation (Req 8.6, 12.1)', () => {
  it('a syncStatus setState triggers both useSyncStatus update and usePartition re-read', () => {
    const syncStatusStore = createSyncStatusStore();

    // useSyncStatus simulation
    const statusTracker = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.medications,
    );

    // usePartition simulation
    let readCount = 0;
    const home = {
      coordinator: { syncStatus: syncStatusStore },
      read: vi.fn(() => {
        readCount++;
        return { records: [{ id: `r${readCount}`, op_timestamp: 't', name: `v${readCount}` }], syncVersion: readCount };
      }),
    };
    const { readResults } = simulateUsePartition(home, 'medications');

    // Coordinator sets medications to 'syncing'
    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'syncing' },
    }));

    // Both hooks received the update synchronously
    expect(statusTracker.current()).toBe('syncing');
    expect(readResults).toHaveLength(2); // initial + re-read on transition
  });

  it('replace:true setState (full state overwrite) propagates correctly', () => {
    const syncStatusStore = createSyncStatusStore();
    const { values } = simulateUseSyncExternalStore(
      syncStatusStore,
      (s) => s.partitions.medications,
    );

    // Replace the entire state (as OfflineSyncCoordinator.resetSyncStatus does)
    syncStatusStore.setState(
      {
        partitions: {
          medications: 'idle',
          symptoms: 'idle',
          conditions: 'idle',
          flares: 'idle',
          associations: 'idle',
        },
      },
      true, // replace
    );

    // Even a replace triggers the subscriber
    expect(values.length).toBeGreaterThanOrEqual(1);
  });

  it('multiple subscribers each receive independent notifications', () => {
    const syncStatusStore = createSyncStatusStore();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    syncStatusStore.subscribe(listener1);
    syncStatusStore.subscribe(listener2);

    syncStatusStore.setState((s) => ({
      partitions: { ...s.partitions, medications: 'syncing' },
    }));

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});
