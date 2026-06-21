/**
 * @complex-patient/ui — Vault store mirroring decrypted partitions
 *
 * Implements the Zustand-style state store from the design (design.md → State
 * Management). The store mirrors the decrypted Local_Vault partitions and obeys
 * three contracts:
 *
 * 1. **Hydrate on unlock** — `hydrate(kek)` decrypts every PHI partition from
 *    the Local_Vault into in-memory projections so the UI can read locally
 *    without blocking on the network (Requirements 5.1, 5.2).
 *
 * 2. **Write-through** — `commit(vaultType, mutator)` routes a change through
 *    encryption + atomic Local_Vault persistence *before* the in-memory
 *    projection reflects the change as committed. The store is a read
 *    cache/projection, never an independent source of truth, so it can never
 *    diverge from the vault (Requirements 5.1, 5.4).
 *
 * 3. **Clear on lock/idle** — `clear()` wipes every PHI projection and discards
 *    the in-memory KEK together, invoked on lock or the 300s idle timeout
 *    (Requirements 3.6, 3.7).
 *
 * The KEK is held in a module-private closure variable, never in store state,
 * so it is never projected to the UI or serialized (Requirements 3.5, 4.8).
 */

import type { CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import { createStore, type StoreApi } from './vanilla-store';
import {
  PHI_VAULT_TYPES,
  type PartitionProjection,
  type VaultStoreCrypto,
  type VaultStorePersistence,
  type VaultStoreState,
} from './types';

/** Partitions that may be reset to empty when decrypt fails during hydrate. */
const OPTIONAL_HYDRATE_PARTITIONS: ReadonlySet<VaultType> = new Set(['locationTrail']);
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** Dependencies injected into {@link createVaultStore}. */
export interface VaultStoreDeps {
  vault: VaultStorePersistence;
  crypto: VaultStoreCrypto;
}

/** Result of a {@link VaultStore.commit} write-through. */
export type CommitResult<T extends VaultRecord> =
  | { ok: true; records: T[] }
  | { ok: false; error: 'LOCKED' | 'PERSIST_FAILED'; message: string };

/**
 * The public store handle: the raw {@link StoreApi} for state subscription plus
 * the lifecycle/commit actions that enforce the source-of-truth contract.
 */
export interface VaultStore {
  /** Underlying reactive store (Zustand-compatible surface). */
  readonly api: StoreApi<VaultStoreState>;

  /** Current state snapshot. */
  getState(): VaultStoreState;
  /** Subscribe to state transitions; returns an unsubscribe function. */
  subscribe(listener: (state: VaultStoreState, prev: VaultStoreState) => void): () => void;

  /** Whether the store currently holds a KEK and hydrated projections. */
  isUnlocked(): boolean;

  /**
   * Hydrate the store by decrypting every PHI partition with `kek` on unlock
   * (Requirements 5.1, 5.2). The KEK is retained privately for subsequent
   * write-throughs and cleared on {@link VaultStore.clear}.
   */
  hydrate(kek: CryptoKeyRef): Promise<void>;

  /** Read the decrypted projection of a partition (local-only read, 5.2). */
  getPartition<T extends VaultRecord>(vaultType: VaultType): PartitionProjection & { records: T[] };

  /**
   * Commit a change through the write-through path: derive the next record set
   * from the current projection, encrypt it, persist it atomically to the
   * Local_Vault, and only then reflect it in the in-memory projection
   * (Requirements 5.1, 5.4). If persistence fails, the projection is left
   * unchanged so the store never diverges from the vault.
   */
  commit<T extends VaultRecord>(
    vaultType: VaultType,
    mutator: (current: T[]) => T[],
  ): Promise<CommitResult<T>>;

  /**
   * After a successful background sync, align the local blob and projection with
   * the server's optimistic-concurrency token so the next push succeeds.
   */
  applySyncedVersion(vaultType: VaultType, syncVersion: number): Promise<void>;

  /**
   * Clear all PHI projections and discard the in-memory KEK together, on lock
   * or idle timeout (Requirements 3.6, 3.7).
   */
  clear(): void;
}

/** Build the empty/locked projection map (no PHI in memory). */
function emptyPartitions(): Record<VaultType, PartitionProjection> {
  const partitions = {} as Record<VaultType, PartitionProjection>;
  for (const vaultType of PHI_VAULT_TYPES) {
    partitions[vaultType] = { records: [], syncVersion: 0 };
  }
  return partitions;
}

/** The initial, locked state: no KEK, empty projections. */
function initialState(): VaultStoreState {
  return { status: 'locked', partitions: emptyPartitions() };
}

/** Map a vault blob to the crypto `EncryptedPayload` shape (auth_tag → authTag). */
function toEncryptedPayload(blob: {
  iv: string;
  auth_tag: string;
  ciphertext: string;
}) {
  return { iv: blob.iv, authTag: blob.auth_tag, ciphertext: blob.ciphertext };
}

/**
 * Create a {@link VaultStore}. The KEK is captured in this closure on hydrate
 * and zeroed on clear — it never enters the reactive state tree.
 */
export function createVaultStore(deps: VaultStoreDeps): VaultStore {
  const { vault, crypto } = deps;

  // KEK lives only here, never in store state (Requirements 3.5, 4.8).
  let kek: CryptoKeyRef | null = null;

  const api = createStore<VaultStoreState>(() => initialState());

  /** Decrypt one partition blob into a projection. Empty when absent. */
  async function hydratePartition(vaultType: VaultType): Promise<PartitionProjection> {
    const blob = await vault.readPartition(vaultType);
    if (blob === null) {
      return { records: [], syncVersion: 0 };
    }
    const result = await crypto.decrypt(toEncryptedPayload(blob), kek as CryptoKeyRef);
    if (!result.ok) {
      if (OPTIONAL_HYDRATE_PARTITIONS.has(vaultType)) {
        console.warn(
          `[VaultStore] optional partition ${vaultType} could not be decrypted; treating as empty`,
        );
        return { records: [], syncVersion: 0 };
      }
      // A corrupt/tampered blob must not silently project an empty set that a
      // later write could clobber; fail the hydrate loudly (Requirement 5.1).
      throw new Error(`failed to decrypt ${vaultType} partition: ${result.error}`);
    }
    const json = utf8Decoder.decode(result.plaintext);
    const parsed = JSON.parse(json) as { records?: VaultRecord[] };
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    return { records, syncVersion: blob.sync_version };
  }

  async function hydrate(nextKek: CryptoKeyRef): Promise<void> {
    kek = nextKek;
    const partitions = {} as Record<VaultType, PartitionProjection>;
    // Decrypt all partitions in parallel — independent reads (Requirement 5.2).
    const entries = await Promise.all(
      PHI_VAULT_TYPES.map(async (vaultType) => {
        const projection = await hydratePartition(vaultType);
        return [vaultType, projection] as const;
      }),
    );
    for (const [vaultType, projection] of entries) {
      partitions[vaultType] = projection;
    }
    api.setState({ status: 'unlocked', partitions }, true);
  }

  function getPartition<T extends VaultRecord>(
    vaultType: VaultType,
  ): PartitionProjection & { records: T[] } {
    const projection = api.getState().partitions[vaultType];
    return projection as PartitionProjection & { records: T[] };
  }

  async function commit<T extends VaultRecord>(
    vaultType: VaultType,
    mutator: (current: T[]) => T[],
  ): Promise<CommitResult<T>> {
    // A commit requires an unlocked vault; while locked, decrypt/persist of PHI
    // is blocked until passphrase re-entry (Requirement 3.8).
    if (kek === null || api.getState().status !== 'unlocked') {
      return { ok: false, error: 'LOCKED', message: 'vault is locked' };
    }

    const current = api.getState().partitions[vaultType];
    const nextRecords = mutator(current.records as T[]);

    // Write-through: encrypt and persist to the Local_Vault BEFORE the
    // in-memory projection reflects the change as committed (Requirement 5.4).
    const plaintext = utf8Encoder.encode(JSON.stringify({ records: nextRecords }));
    let encrypted;
    try {
      encrypted = await crypto.encrypt(plaintext, kek);
      await vault.writePartition(vaultType, {
        sync_version: current.syncVersion,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        ciphertext: encrypted.ciphertext,
      });
    } catch (cause) {
      // Persistence failed — leave the projection unchanged so the store never
      // diverges from the vault (Requirement 5.1).
      return {
        ok: false,
        error: 'PERSIST_FAILED',
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }

    // Only now reflect the committed state in memory (read-cache projection).
    api.setState((state) => ({
      partitions: {
        ...state.partitions,
        [vaultType]: {
          records: nextRecords,
          syncVersion: current.syncVersion,
        },
      },
    }));

    return { ok: true, records: nextRecords };
  }

  async function applySyncedVersion(vaultType: VaultType, syncVersion: number): Promise<void> {
    if (api.getState().status !== 'unlocked') {
      return;
    }

    const blob = await vault.readPartition(vaultType);
    if (blob === null) {
      return;
    }

    if (blob.sync_version === syncVersion) {
      api.setState((state) => ({
        partitions: {
          ...state.partitions,
          [vaultType]: {
            ...state.partitions[vaultType],
            syncVersion,
          },
        },
      }));
      return;
    }

    await vault.writePartition(vaultType, {
      ...blob,
      sync_version: syncVersion,
    });

    api.setState((state) => ({
      partitions: {
        ...state.partitions,
        [vaultType]: {
          ...state.partitions[vaultType],
          syncVersion,
        },
      },
    }));
  }

  function clear(): void {
    // Discard the in-memory KEK and wipe every PHI projection together
    // (Requirements 3.6, 3.7).
    kek = null;
    api.setState(initialState(), true);
  }

  return {
    api,
    getState: () => api.getState(),
    subscribe: (listener) => api.subscribe(listener),
    isUnlocked: () => kek !== null && api.getState().status === 'unlocked',
    hydrate,
    getPartition,
    commit,
    applySyncedVersion,
    clear,
  };
}
