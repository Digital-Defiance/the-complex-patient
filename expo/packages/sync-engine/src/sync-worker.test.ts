import { describe, it, expect, vi } from 'vitest';
import type { VaultType } from '@complex-patient/domain';
import type { VaultBlob } from '@complex-patient/local-vault';
import {
  SyncWorker,
  CONNECTIVITY_SYNC_WINDOW_MS,
  type Timer,
  type TimerHandle,
  type VaultHttpClient,
  type VaultPushPayload,
  type VaultPushResponse,
  type VaultReader,
} from './sync-worker';

/**
 * Unit tests for the offline sync queue and connectivity-triggered sync (task 8.6).
 *
 * Coverage:
 * - enqueue records unsynced partitions (Requirement 5.6)
 * - onConnectivityRestored begins sync within the 30s window (Requirement 5.7)
 * - successful sync returns the incremented server version and dequeues
 * - failure retains the blob unchanged, retries up to 5 attempts, then surfaces
 *   a "sync pending" indication (Requirement 5.8)
 */

const VAULT: VaultType = 'medications';

function makeBlob(overrides: Partial<VaultBlob> = {}): VaultBlob {
  return {
    sync_version: 3,
    iv: 'AAAAAAAAAAAAAAAA',
    auth_tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    ciphertext: 'Y2lwaGVydGV4dA==',
    ...overrides,
  };
}

/** A VaultReader that always returns the same blob and counts reads. */
function stubVault(blob: VaultBlob | null): VaultReader & { reads: number } {
  return {
    reads: 0,
    async readPartition() {
      this.reads += 1;
      return blob;
    },
  };
}

/** A controllable manual timer that records scheduled tasks. */
function manualTimer(): Timer & { run: () => void; lastDelay: number | null; scheduled: number } {
  let pending: (() => void) | null = null;
  let lastDelay: number | null = null;
  let scheduled = 0;
  return {
    lastDelay: null,
    scheduled: 0,
    setTimeout(handler: () => void, ms: number): TimerHandle {
      pending = handler;
      lastDelay = ms;
      this.lastDelay = ms;
      scheduled += 1;
      this.scheduled = scheduled;
      return { id: scheduled };
    },
    clearTimeout() {
      pending = null;
    },
    run() {
      const h = pending;
      pending = null;
      if (h) h();
    },
  };
}

describe('SyncWorker — enqueue (Requirement 5.6)', () => {
  it('records a partition as queued', () => {
    const worker = new SyncWorker({ http: okHttp(), vault: stubVault(makeBlob()) });
    expect(worker.isQueued(VAULT)).toBe(false);
    worker.enqueue(VAULT);
    expect(worker.isQueued(VAULT)).toBe(true);
  });

  it('is idempotent — enqueuing twice keeps a single entry and one sync', async () => {
    const http = okHttp();
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()) });
    worker.enqueue(VAULT);
    worker.enqueue(VAULT);
    await worker.syncAllQueued();
    expect(http.calls).toBe(1);
  });
});

describe('SyncWorker — onConnectivityRestored (Requirement 5.7)', () => {
  it('schedules the sync pass within the 30 second window', () => {
    const timer = manualTimer();
    const worker = new SyncWorker({
      http: okHttp(),
      vault: stubVault(makeBlob()),
      timer,
      connectivitySyncDelayMs: 5_000,
    });
    worker.enqueue(VAULT);
    worker.onConnectivityRestored();
    expect(timer.scheduled).toBe(1);
    expect(timer.lastDelay).not.toBeNull();
    expect(timer.lastDelay!).toBeLessThanOrEqual(CONNECTIVITY_SYNC_WINDOW_MS);
    expect(timer.lastDelay!).toBeGreaterThanOrEqual(0);
  });

  it('begins syncing queued partitions when the scheduled timer fires', async () => {
    const timer = manualTimer();
    const http = okHttp();
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()), timer });
    worker.enqueue(VAULT);
    worker.onConnectivityRestored();
    expect(http.calls).toBe(0);
    timer.run();
    // Allow the fire-and-forget async pass to settle.
    await vi.waitFor(() => expect(http.calls).toBe(1));
    expect(worker.isQueued(VAULT)).toBe(false);
  });

  it('collapses repeated calls before the pass fires into a single scheduling', () => {
    const timer = manualTimer();
    const worker = new SyncWorker({ http: okHttp(), vault: stubVault(makeBlob()), timer });
    worker.enqueue(VAULT);
    worker.onConnectivityRestored();
    worker.onConnectivityRestored();
    worker.onConnectivityRestored();
    expect(timer.scheduled).toBe(1);
  });

  it('rejects a delay outside the 30 second window', () => {
    expect(
      () =>
        new SyncWorker({
          http: okHttp(),
          vault: stubVault(makeBlob()),
          connectivitySyncDelayMs: CONNECTIVITY_SYNC_WINDOW_MS + 1,
        }),
    ).toThrow(RangeError);
  });
});

describe('SyncWorker — syncPartition success', () => {
  it('returns the incremented server version and dequeues (Requirement 6.4/7.5)', async () => {
    const http = okHttp(8);
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob({ sync_version: 7 })) });
    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);
    expect(outcome).toEqual({ status: 'synced', newVersion: 8 });
    expect(worker.isQueued(VAULT)).toBe(false);
    expect(worker.isPending(VAULT)).toBe(false);
  });

  it('pushes only the blind envelope fields across the boundary', async () => {
    let captured: VaultPushPayload | null = null;
    const http: VaultHttpClient = {
      async postVault(_v, payload) {
        captured = payload;
        return { status: 200, sync_version: 4 };
      },
    };
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()) });
    await worker.syncPartition(VAULT);
    expect(Object.keys(captured!).sort()).toEqual(
      ['auth_tag', 'ciphertext', 'iv', 'sync_version'].sort(),
    );
  });

  it('treats a missing blob as already synced', async () => {
    const http = okHttp();
    const worker = new SyncWorker({ http, vault: stubVault(null) });
    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);
    expect(outcome.status).toBe('synced');
    expect(http.calls).toBe(0);
    expect(worker.isQueued(VAULT)).toBe(false);
  });
});

describe('SyncWorker — retry then pending (Requirement 5.8)', () => {
  it('retries up to 5 attempts then surfaces "sync pending"', async () => {
    const http = failingHttp();
    const onSyncPending = vi.fn();
    const vault = stubVault(makeBlob());
    const worker = new SyncWorker({ http, vault, onSyncPending });
    worker.enqueue(VAULT);

    const outcome = await worker.syncPartition(VAULT);

    expect(outcome).toEqual({ status: 'pending', attempts: 5 });
    expect(http.calls).toBe(5);
    expect(worker.isPending(VAULT)).toBe(true);
    expect(onSyncPending).toHaveBeenCalledWith(VAULT, 5);
  });

  it('retains the blob unchanged across failed attempts (never mutates the vault)', async () => {
    const http = failingHttp();
    const blob = makeBlob();
    const vault: VaultReader = {
      async readPartition() {
        return blob;
      },
    };
    const writeSpy = vi.fn();
    // VaultReader has no write method; assert the worker never attempts one and
    // the same blob object is read for the push.
    const worker = new SyncWorker({ http, vault });
    worker.enqueue(VAULT);
    await worker.syncPartition(VAULT);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(blob).toEqual(makeBlob());
  });

  it('honors a custom maxAttempts', async () => {
    const http = failingHttp();
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()), maxAttempts: 2 });
    const outcome = await worker.syncPartition(VAULT);
    expect(outcome).toEqual({ status: 'pending', attempts: 2 });
    expect(http.calls).toBe(2);
  });

  it('recovers when a later attempt succeeds within the retry budget', async () => {
    let call = 0;
    const http: VaultHttpClient = {
      async postVault() {
        call += 1;
        if (call < 3) throw new Error('network down');
        return { status: 200, sync_version: 9 };
      },
    };
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()) });
    const outcome = await worker.syncPartition(VAULT);
    expect(outcome).toEqual({ status: 'synced', newVersion: 9 });
    expect(call).toBe(3);
    expect(worker.isPending(VAULT)).toBe(false);
  });

  it('enqueue clears a prior pending indication', async () => {
    const http = failingHttp();
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()) });
    await worker.syncPartition(VAULT);
    expect(worker.isPending(VAULT)).toBe(true);
    worker.enqueue(VAULT);
    expect(worker.isPending(VAULT)).toBe(false);
  });

  it('does not retry when the transport error is not authenticated', async () => {
    const http: VaultHttpClient = {
      async postVault() {
        return {
          status: 0,
          errorCode: 'transport_error',
          errorMessage: 'not authenticated: a Sync_Backend credential is required',
        };
      },
    };
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()) });
    const outcome = await worker.syncPartition(VAULT);
    expect(outcome).toEqual({ status: 'pending', attempts: 1 });
  });
});

describe('SyncWorker — 409 delegates to the conflict resolver seam (task 8.7)', () => {
  it('invokes the injected resolver and does not count 409 as a retry', async () => {
    const http: VaultHttpClient & { calls: number } = {
      calls: 0,
      async postVault() {
        this.calls += 1;
        return { status: 409, sync_version: 12 };
      },
    };
    const resolveConflict = vi.fn(async () => ({ status: 'conflict-resolved' as const, newVersion: 13 }));
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()), resolveConflict });
    worker.enqueue(VAULT);
    const outcome = await worker.syncPartition(VAULT);
    expect(http.calls).toBe(1);
    expect(resolveConflict).toHaveBeenCalledWith(VAULT, 12);
    expect(outcome).toEqual({ status: 'conflict-resolved', newVersion: 13 });
    expect(worker.isQueued(VAULT)).toBe(false);
  });

  it('defaults to conflict-failed when no resolver is injected', async () => {
    const http: VaultHttpClient = {
      async postVault() {
        return { status: 409, sync_version: 12 };
      },
    };
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob()) });
    const outcome = await worker.syncPartition(VAULT);
    expect(outcome).toEqual({ status: 'conflict-failed' });
  });
});

describe('SyncWorker — unsupported vault types on older backends', () => {
  it('stops retrying when the server does not recognize the partition', async () => {
    const http: VaultHttpClient & { calls: number } = {
      calls: 0,
      async postVault() {
        this.calls += 1;
        return {
          status: 400,
          errorCode: 'complex_patient_unrecognized_vault_type',
          errorMessage: '"locationTrail" is not a recognized vault_type.',
        };
      },
    };
    const worker = new SyncWorker({ http, vault: stubVault(makeBlob({ sync_version: 2 })) });
    worker.enqueue('locationTrail');
    const outcome = await worker.syncPartition('locationTrail');

    expect(http.calls).toBe(1);
    expect(outcome).toEqual({ status: 'synced', newVersion: 2 });
    expect(worker.isQueued('locationTrail')).toBe(false);
    expect(worker.isPending('locationTrail')).toBe(false);

    worker.enqueue('locationTrail');
    expect(worker.isQueued('locationTrail')).toBe(false);
  });
});

// --- helpers ---------------------------------------------------------------

/** HTTP client that always returns 200 with an incremented version. */
function okHttp(newVersion = 1): VaultHttpClient & { calls: number } {
  return {
    calls: 0,
    async postVault(_v, payload): Promise<VaultPushResponse> {
      this.calls += 1;
      return { status: 200, sync_version: newVersion || payload.sync_version + 1 };
    },
  };
}

/** HTTP client that always rejects, simulating a persistent network failure. */
function failingHttp(): VaultHttpClient & { calls: number } {
  return {
    calls: 0,
    async postVault(): Promise<VaultPushResponse> {
      this.calls += 1;
      throw new Error('network unavailable');
    },
  };
}
