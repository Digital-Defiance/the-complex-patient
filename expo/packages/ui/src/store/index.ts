/**
 * @complex-patient/ui — Vault store barrel
 *
 * The Zustand-style store that mirrors the decrypted Local_Vault partitions
 * (design.md → State Management, Requirements 5.1, 5.2, 5.4, 3.6, 3.7).
 */

export type {
  StoreApi,
  StateCreator,
  StateListener,
  StateSelector,
} from './vanilla-store';
export { createStore } from './vanilla-store';

export type {
  VaultBlobLike,
  VaultStoreCrypto,
  VaultStorePersistence,
  PartitionProjection,
  VaultStoreStatus,
  VaultStoreState,
} from './types';
export { PHI_VAULT_TYPES } from './types';

export type {
  VaultStore,
  VaultStoreDeps,
  CommitResult,
} from './vault-store';
export { createVaultStore } from './vault-store';

export type { LockBinding, LockBindingDeps } from './lock-binding';
export { bindStoreToLock } from './lock-binding';

export type {
  PartitionSyncStatus,
  SyncStatusState,
  SyncWorkerLike,
  OfflineSyncCoordinator,
  OfflineSyncCoordinatorDeps,
} from './offline-sync';
export { createOfflineSyncCoordinator } from './offline-sync';
