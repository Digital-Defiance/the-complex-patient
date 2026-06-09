/**
 * @complex-patient/ui — Vault store types
 *
 * Dependency-injection seams and state shape for the {@link VaultStore} that
 * mirrors the decrypted Local_Vault partitions (design.md → State Management).
 *
 * The store is a *read cache / projection* of the Local_Vault, never an
 * independent source of truth (Requirements 5.1, 5.4). Every seam below is
 * injected so the store is fully testable under vitest without native crypto or
 * storage modules.
 */

import type { CryptoKeyRef, EncryptedPayload, DecryptResult } from '@complex-patient/crypto-engine';
import type { VaultRecord, VaultType } from '@complex-patient/domain';

/**
 * The encrypted envelope persisted per partition. Mirrors
 * `@complex-patient/local-vault` `VaultBlob` structurally so the concrete
 * `LocalVault` is assignable without a hard type coupling.
 */
export interface VaultBlobLike {
  sync_version: number;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

/**
 * The subset of the Crypto_Engine the store depends on, matching the
 * `encrypt` / `decrypt` functions of `@complex-patient/crypto-engine`.
 */
export interface VaultStoreCrypto {
  encrypt(plaintext: Uint8Array, kek: CryptoKeyRef): Promise<EncryptedPayload>;
  decrypt(blob: EncryptedPayload, kek: CryptoKeyRef): Promise<DecryptResult>;
}

/**
 * The subset of the Local_Vault the store depends on: read partition blobs on
 * hydrate, and atomically write them on commit (Requirements 5.4, 5.1).
 */
export interface VaultStorePersistence {
  readPartition(vaultType: VaultType): Promise<VaultBlobLike | null>;
  writePartition(vaultType: VaultType, blob: VaultBlobLike): Promise<void>;
}

/**
 * The PHI partitions mirrored by the store. All five vault types hold PHI and
 * are cleared together on lock/idle timeout (Requirements 3.6, 3.7).
 */
export const PHI_VAULT_TYPES: readonly VaultType[] = [
  'medications',
  'symptoms',
  'conditions',
  'flares',
  'associations',
] as const;

/**
 * The decrypted projection of a single partition: its record set plus the
 * `sync_version` of the blob it was hydrated from, preserved so a subsequent
 * write-through keeps the optimistic-concurrency token intact (Requirement 7).
 */
export interface PartitionProjection {
  records: VaultRecord[];
  syncVersion: number;
}

/**
 * Lifecycle status of the store.
 *
 * - `locked`: no KEK held; PHI projections are empty (Requirements 3.6–3.8).
 * - `unlocked`: hydrated from the Local_Vault and serving reads (Requirement 5.2).
 */
export type VaultStoreStatus = 'locked' | 'unlocked';

/**
 * The serializable state held by the store. It deliberately contains NO key
 * material: the KEK lives in a closure, never in store state, so it can never
 * be projected to the UI or serialized across the network (Requirements 3.5,
 * 4.8).
 */
export interface VaultStoreState {
  status: VaultStoreStatus;
  partitions: Record<VaultType, PartitionProjection>;
}
