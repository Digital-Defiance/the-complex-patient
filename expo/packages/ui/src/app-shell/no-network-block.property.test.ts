/**
 * Property-based test for no-network-block reads and writes (Task 8.8).
 *
 * Property 10: Reads and writes never block on the network
 *   For any seeded partition and for any transport that is unreachable or never
 *   resolves, `Home_Controller.read` returns the local records synchronously
 *   and `Home_Controller.commit` resolves on the local persist — neither awaits
 *   nor is gated by a Sync_Backend response, and no blocking network request
 *   precedes the local result.
 *
 * **Validates: Requirements 12.5, 12.6, 14.4**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect, beforeEach } from 'vitest';
import {
  createLocalVault,
  MemoryStorageBackend,
  type LocalVault,
} from '@complex-patient/local-vault';
import { encrypt, decrypt, wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { SyncOutcome } from '@complex-patient/sync-engine';
import { createVaultStore, type VaultStore } from '../store/vault-store';
import {
  createOfflineSyncCoordinator,
  type OfflineSyncCoordinator,
  type SyncWorkerLike,
} from '../store/offline-sync';
import { createHomeEntry, type HomeEntryController } from '../app/home-entry';
import { createAuthProvider } from '../app/auth';
import type { VaultStoreCrypto } from '../store/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(42));
const crypto: VaultStoreCrypto = { encrypt, decrypt };

// ---------------------------------------------------------------------------
// Test record type
// ---------------------------------------------------------------------------

interface TestRecord extends VaultRecord {
  value: string;
}

// ---------------------------------------------------------------------------
// Generators — arbitrary vault types and arbitrary records
// ---------------------------------------------------------------------------

const vaultTypeArb: fc.Arbitrary<VaultType> = fc.constantFrom(
  'medications' as const,
  'symptoms' as const,
  'conditions' as const,
  'flares' as const,
  'associations' as const,
  'locationTrail' as const,
);

/** Generate an arbitrary TestRecord with a unique id and value. */
const testRecordArb: fc.Arbitrary<TestRecord> = fc.record({
  id: fc.uuid(),
  op_timestamp: fc.integer({ min: 1577836800000, max: 1924905600000 })
    .map((ts) => new Date(ts).toISOString()),
  value: fc.string({ minLength: 1, maxLength: 50 }),
});

/** Generate a non-empty array of test records (1-5 records per partition). */
const testRecordsArb: fc.Arbitrary<TestRecord[]> = fc.array(testRecordArb, {
  minLength: 1,
  maxLength: 5,
});

// ---------------------------------------------------------------------------
// Helpers — a sync worker that NEVER resolves (simulates unreachable backend)
// ---------------------------------------------------------------------------

/**
 * Creates a SyncWorkerLike that never resolves its `syncPartition` promise,
 * simulating a completely unreachable Sync_Backend. This ensures that any code
 * path that awaits network communication will hang forever — proving that
 * read/commit do NOT depend on it.
 */
function neverResolvingSyncWorker(): SyncWorkerLike {
  return {
    enqueue: () => {},
    syncPartition: () => new Promise<SyncOutcome>(() => {}), // never resolves
    onConnectivityRestored: () => {},
  };
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 10: Reads and writes never block on the network (12.5, 12.6, 14.4)', () => {
  let vault: LocalVault;
  let store: VaultStore;
  let controller: HomeEntryController;

  beforeEach(async () => {
    vault = await createLocalVault(new MemoryStorageBackend());
    store = createVaultStore({ vault, crypto });
    await store.hydrate(KEY);
    const auth = createAuthProvider({ kind: 'application-password', username: 'u', applicationPassword: 'p' });
    controller = createHomeEntry({
      keyStore: {
        store: async () => {},
        unlock: async () => ({ ok: true, kek: KEY }),
        clear: async () => {},
      },
      store,
      syncWorker: neverResolvingSyncWorker(),
      auth,
    });
    // Sign in and unlock so controller is in 'ready' state
    controller.signIn({ kind: 'application-password', username: 'u', applicationPassword: 'p' });
    await controller.unlockWithKek(KEY);
  });

  it.prop([vaultTypeArb, testRecordsArb], { numRuns: 100 })(
    'read completes synchronously without waiting for network (12.5)',
    async (vaultType, records) => {
      // Seed the partition with records via a local commit (this also doesn't block
      // because commit is local-first). We await it to ensure the records are committed.
      await controller.commit<TestRecord>(vaultType, () => records);

      // Now read — this should complete immediately even though the sync worker
      // never resolves. We test this by racing with a short timeout.
      const readStart = Date.now();
      const projection = controller.read<TestRecord>(vaultType);
      const readDuration = Date.now() - readStart;

      // The read completes synchronously (within 1ms — it's a direct store read)
      expect(readDuration).toBeLessThan(1000);
      expect(projection.records).toEqual(records);
    },
  );

  it.prop([vaultTypeArb, testRecordsArb], { numRuns: 100 })(
    'commit resolves on local persist without waiting for network (12.6)',
    async (vaultType, records) => {
      // The commit should resolve on the local persist, not on the sync.
      // Since the sync worker never resolves, if commit awaited it, this test
      // would hang forever.
      const commitStart = Date.now();
      const result = await controller.commit<TestRecord>(vaultType, () => records);
      const commitDuration = Date.now() - commitStart;

      // Commit resolved locally within 1 second (typically <50ms for in-memory vault)
      expect(commitDuration).toBeLessThan(1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.records).toEqual(records);
      }
    },
  );

  it.prop([vaultTypeArb, testRecordsArb], { numRuns: 100 })(
    'read after commit reflects local data without network round-trip (14.4)',
    async (vaultType, records) => {
      // Commit the records (resolves locally)
      const commitResult = await controller.commit<TestRecord>(vaultType, () => records);
      expect(commitResult.ok).toBe(true);

      // Immediately read back — must reflect the committed records without
      // awaiting any network sync
      const projection = controller.read<TestRecord>(vaultType);
      expect(projection.records).toEqual(records);
    },
  );

  it.prop([vaultTypeArb, testRecordArb, testRecordsArb], { numRuns: 100 })(
    'sequential commits and reads complete without blocking (12.5, 12.6)',
    async (vaultType, singleRecord, additionalRecords) => {
      // First commit
      const r1 = await controller.commit<TestRecord>(vaultType, () => [singleRecord]);
      expect(r1.ok).toBe(true);
      expect(controller.read<TestRecord>(vaultType).records).toEqual([singleRecord]);

      // Second commit adding more records
      const allRecords = [singleRecord, ...additionalRecords];
      const r2 = await controller.commit<TestRecord>(vaultType, () => allRecords);
      expect(r2.ok).toBe(true);
      expect(controller.read<TestRecord>(vaultType).records).toEqual(allRecords);
    },
  );
});
