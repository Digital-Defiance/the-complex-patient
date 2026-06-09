/**
 * @complex-patient/sync-engine
 *
 * Sync_Worker, offline queue, three-way merge, and optimistic concurrency.
 */

export { threeWayMerge } from './merge';

export {
  SyncWorker,
  realTimer,
  CONNECTIVITY_SYNC_WINDOW_MS,
  DEFAULT_MAX_ATTEMPTS,
} from './sync-worker';
export type {
  SyncOutcome,
  SyncWorkerDeps,
  VaultHttpClient,
  VaultReader,
  VaultPushPayload,
  VaultPushResponse,
  VaultGetResponse,
  Timer,
  TimerHandle,
  ConflictResolver,
} from './sync-worker';

export {
  createConflictResolver,
  CONFLICT_FETCH_TIMEOUT_MS,
  DEFAULT_CONFLICT_RETRIES,
} from './conflict-resolver';
export type {
  ConflictResolverDeps,
  ConflictCrypto,
  ConflictVault,
  ConflictHttp,
  ConflictFailureReason,
} from './conflict-resolver';
