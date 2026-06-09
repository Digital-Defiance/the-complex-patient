import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { SyncOutcome } from '@complex-patient/sync-engine';
import { createVaultStore, type VaultStore } from './vault-store';
import {
  createOfflineSyncCoordinator,
  type OfflineSyncCoordinator,
  type SyncWorkerLike,
} from './offline-sync';
import type { VaultStoreCrypto } from './types';

/**
 * Tests for the offline-first read/write wiring + Sync_Worker binding (task 15.2).
 *
 * These exercise the REAL Crypto_Engine and the REAL EncryptedLocalVault over an
 * in-memory backend so they validate the actual local-first write path. The
 * Sync_Worker is a controllable fake so we can assert ordering (local persist
 * BEFORE enqueue/sync) and surface every sync outcome deterministically.
 *
 * Coverage:
 * - reads come from the local mirror, never the network (5.2)
 * - writes persist locally and confirm BEFORE enqueueing sync (5.3, 5.4, 5.6)
 * - the write path never blocks on the Sync_Backend (5.2)
 * - a failed local persist never enqueues a sync (5.1)
 * - sync-pending (5.8) and conflict (8.9) indications are surfaced per partition
 * - offline CRUD is always allowed regardless of connectivity (5.5)
 */

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(11));
const crypto: VaultStoreCrypto = { encrypt, decrypt };

interface MedRec extends VaultRecord {
  drugName: string;
}

/** A controllable fake Sync_Worker recording the order of calls. */
function fakeWorker(outcome: SyncOutcome = { status: 'synced', newVersion: 1 }) {
  const events: string[] = [];
  let nextOutcome = outcome;
  let resolveGate: (() => void) | null = null;
  let gate: Promise<void> | null = null;

  const worker: SyncWorkerLike & {
    events: string[];
    setOutcome(o: SyncOutcome): void;
    /** Block the next syncPartition until released (to test non-blocking writes). */
    block(): void;
    release(): void;
  } = {
    events,
    enqueue(vaultType: VaultType) {
      events.push(`enqueue:${vaultType}`);
    },
    async syncPartition(vaultType: VaultType) {
      events.push(`syncPartition:${vaultType}`);
      if (gate) {
        await gate;
      }
      return nextOutcome;
    },
    onConnectivityRestored() {
      events.push('onConnectivityRestored');
    },
    setOutcome(o: SyncOutcome) {
      nextOutcome = o;
    },
    block() {
      gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });
    },
    release() {
      resolveGate?.();
      gate = null;
    },
  };
  return worker;
}

describe('createOfflineSyncCoordinator — read path (5.2)', () => {
  let vault: LocalVault;
  let store: VaultStore;
  let coordinator: OfflineSyncCoordinator;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
    coordinator = createOfflineSyncCoordinator({ store, syncWorker: fakeWorker() });
  });

  it('reads the partition projection from the local mirror', async () => {
    await coordinator.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm1', op_timestamp: 't', drugName: 'aspirin' },
    ]);
    const projection = coordinator.read<MedRec>('medications');
    expect(projection.records).toEqual([
      { id: 'm1', op_timestamp: 't', drugName: 'aspirin' },
    ]);
  });
});

describe('createOfflineSyncCoordinator — write path ordering (5.3, 5.4, 5.6)', () => {
  let vault: LocalVault;
  let store: VaultStore;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
  });

  it('persists locally and confirms BEFORE enqueuing sync', async () => {
    const worker = fakeWorker();
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });

    const result = await coordinator.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm1', op_timestamp: 't', drugName: 'aspirin' },
    ]);

    expect(result.ok).toBe(true);
    // The local write is durably readable from the vault.
    const blob = await vault.readPartition('medications');
    expect(blob).not.toBeNull();

    // enqueue happened, and it happened only after the local persist confirmed.
    expect(worker.events[0]).toBe('enqueue:medications');
    expect(worker.events).toContain('syncPartition:medications');
  });

  it('does not block the write on the Sync_Backend (5.2)', async () => {
    const worker = fakeWorker();
    worker.block(); // syncPartition will hang until released
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });

    // The commit resolves even though the sync is still in flight.
    const result = await coordinator.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm1', op_timestamp: 't', drugName: 'aspirin' },
    ]);
    expect(result.ok).toBe(true);
    // Local projection already reflects the committed write.
    expect(coordinator.read<MedRec>('medications').records).toHaveLength(1);

    worker.release();
  });

  it('does NOT enqueue a sync when the local persist fails (5.1)', async () => {
    const failingVault = {
      readPartition: vault.readPartition.bind(vault),
      writePartition: async () => {
        throw new Error('disk full');
      },
    };
    const failStore = createVaultStore({ vault: failingVault as never, crypto });
    await failStore.hydrate(KEY);
    const worker = fakeWorker();
    const coordinator = createOfflineSyncCoordinator({ store: failStore, syncWorker: worker });

    const result = await coordinator.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'x', op_timestamp: 't', drugName: 'x' },
    ]);

    expect(result.ok).toBe(false);
    expect(worker.events).toEqual([]); // no enqueue, no sync
  });
});

describe('createOfflineSyncCoordinator — sync indications (5.6, 5.8, 8.9)', () => {
  let vault: LocalVault;
  let store: VaultStore;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
  });

  it('surfaces idle after a successful sync', async () => {
    const worker = fakeWorker({ status: 'synced', newVersion: 2 });
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });
    const outcome = await coordinator.syncNow('medications');
    expect(outcome).toEqual({ status: 'synced', newVersion: 2 });
    expect(coordinator.getSyncStatus('medications')).toBe('idle');
  });

  it('surfaces "pending" when the worker exhausts its retry budget (5.8)', async () => {
    const worker = fakeWorker({ status: 'pending', attempts: 5 });
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });
    await coordinator.syncNow('symptoms');
    expect(coordinator.getSyncStatus('symptoms')).toBe('pending');
  });

  it('surfaces "conflict" when the 409 merge cycle cannot complete (8.9)', async () => {
    const worker = fakeWorker({ status: 'conflict-failed' });
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });
    await coordinator.syncNow('flares');
    expect(coordinator.getSyncStatus('flares')).toBe('conflict');
  });

  it('clears the status back to idle when a conflict is resolved', async () => {
    const worker = fakeWorker({ status: 'conflict-resolved', newVersion: 7 });
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });
    await coordinator.syncNow('conditions');
    expect(coordinator.getSyncStatus('conditions')).toBe('idle');
  });

  it('notifies subscribers of the syncing → terminal status transition', async () => {
    const worker = fakeWorker({ status: 'pending', attempts: 5 });
    worker.block();
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });

    const seen: string[] = [];
    coordinator.syncStatus.subscribe((state) => {
      seen.push(state.partitions.medications);
    });

    const pass = coordinator.syncNow('medications');
    expect(coordinator.getSyncStatus('medications')).toBe('syncing');
    worker.release();
    await pass;

    expect(seen).toContain('syncing');
    expect(seen[seen.length - 1]).toBe('pending');
  });

  it('treats a worker throw as pending while retaining local data (5.8)', async () => {
    const worker: SyncWorkerLike = {
      enqueue: vi.fn(),
      onConnectivityRestored: vi.fn(),
      syncPartition: async () => {
        throw new Error('worker crashed');
      },
    };
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });
    const outcome = await coordinator.syncNow('medications');
    expect(outcome.status).toBe('pending');
    expect(coordinator.getSyncStatus('medications')).toBe('pending');
  });
});

describe('createOfflineSyncCoordinator — offline always enabled (5.5)', () => {
  it('allows full CRUD with no connectivity and no disable option', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
    // A worker that always fails to reach the backend models being offline.
    const worker = fakeWorker({ status: 'pending', attempts: 5 });
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });

    // Create
    let r = await coordinator.commit<MedRec>('medications', (cur) => [
      ...cur,
      { id: 'm1', op_timestamp: 't1', drugName: 'aspirin' },
    ]);
    expect(r.ok).toBe(true);

    // Update
    r = await coordinator.commit<MedRec>('medications', (cur) =>
      cur.map((m) => (m.id === 'm1' ? { ...m, drugName: 'ibuprofen' } : m)),
    );
    expect(r.ok).toBe(true);
    expect(coordinator.read<MedRec>('medications').records[0].drugName).toBe('ibuprofen');

    // Delete (soft-delete tombstone)
    r = await coordinator.commit<MedRec>('medications', (cur) =>
      cur.map((m) => (m.id === 'm1' ? { ...m, deleted: true } : m)),
    );
    expect(r.ok).toBe(true);

    // All offline writes succeeded locally; sync is independently pending.
    expect(coordinator.getSyncStatus('medications')).toBe('pending');

    // The coordinator exposes no API to disable offline operation.
    expect((coordinator as Record<string, unknown>).disableOffline).toBeUndefined();
  });

  it('forwards connectivity restoration to the worker (5.7)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
    const worker = fakeWorker();
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });

    coordinator.onConnectivityRestored();
    expect(worker.events).toContain('onConnectivityRestored');
  });

  it('resetSyncStatus returns every partition to idle', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
    const worker = fakeWorker({ status: 'pending', attempts: 5 });
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });

    await coordinator.syncNow('medications');
    expect(coordinator.getSyncStatus('medications')).toBe('pending');

    coordinator.resetSyncStatus();
    expect(coordinator.getSyncStatus('medications')).toBe('idle');
    expect(coordinator.getSyncStatus('symptoms')).toBe('idle');
  });

  it('auto-resets sync badges when the vault locks (3.6, 3.7)', async () => {
    const vault = await createLocalVault(new MemoryStorageBackend());
    const store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
    const worker = fakeWorker({ status: 'pending', attempts: 5 });
    const coordinator = createOfflineSyncCoordinator({ store, syncWorker: worker });

    await coordinator.syncNow('medications');
    expect(coordinator.getSyncStatus('medications')).toBe('pending');

    // Locking clears the store (status → 'locked'); the coordinator must drop
    // the stale "pending" badge so it cannot survive into the next unlock.
    store.clear();
    expect(coordinator.getSyncStatus('medications')).toBe('idle');

    coordinator.dispose();
  });
});
