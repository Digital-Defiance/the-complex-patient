/**
 * Sync_Worker — offline sync queue and connectivity-triggered synchronization.
 *
 * The Sync_Worker is the background client-side process that bridges the
 * Local_Vault (source of truth) and the blind Sync_Backend (Requirement 5.6).
 * It is intentionally constructed from injected collaborators — an HTTP client,
 * a Local_Vault reader, and a timer/clock — so it can be exercised under vitest
 * with no real network and no real wall-clock timers.
 *
 * Responsibilities implemented here (task 8.6):
 * - `enqueue(vaultType)` — record that a partition has unsynced local changes
 *   that must eventually be pushed to the Sync_Backend (Requirement 5.6).
 * - `onConnectivityRestored()` — once connectivity returns, begin synchronizing
 *   the affected partitions within 30 seconds (Requirement 5.7). The delay is
 *   driven by the injected {@link Timer} so tests control time deterministically.
 * - `syncPartition(vaultType)` — perform the `POST /vault/{vault_type}`. On
 *   failure the affected blob is retained unchanged in the Local_Vault, the push
 *   is retried up to 5 attempts, and after the final failed attempt a
 *   "sync pending" indication is surfaced (Requirement 5.8).
 *
 * The HTTP 409 conflict-resolution three-way-merge protocol (Requirement 8) is
 * deliberately NOT implemented here. A 409 response is delegated to the
 * {@link ConflictResolver} seam, which task 8.7 will fill in. The default
 * resolver is a placeholder that reports `conflict-failed` without touching the
 * Local_Vault.
 */

import type { VaultType } from '@complex-patient/domain';
import type { VaultBlob } from '@complex-patient/local-vault';

/**
 * The maximum window, in milliseconds, within which synchronization must begin
 * after connectivity is restored (Requirement 5.7).
 */
export const CONNECTIVITY_SYNC_WINDOW_MS = 30_000;

/**
 * The maximum number of push attempts for a single partition before the worker
 * surfaces a "sync pending" indication (Requirement 5.8).
 */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * The outcome of synchronizing a single partition.
 *
 * Mirrors the design's `SyncOutcome` (see design.md → Sync_Worker).
 */
export type SyncOutcome =
  | { status: 'synced'; newVersion: number }
  | { status: 'pending'; attempts: number }
  | { status: 'conflict-resolved'; newVersion: number }
  | { status: 'conflict-failed' };

/**
 * The blind payload pushed across the zero-knowledge boundary. Only the
 * optimistic-concurrency token and the encrypted envelope fields ever leave the
 * device (Requirements 2.8, 4.6, 6.3).
 */
export interface VaultPushPayload {
  sync_version: number;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

/**
 * The normalized result of a `POST /vault/{vault_type}` call.
 *
 * - `status` is the HTTP status code (200 success, 409 version conflict, etc.).
 * - `sync_version` carries the server's current stored version. It is present
 *   on a 200 (the incremented version) and on a 409 (the current stored version
 *   that the client must reconcile against).
 */
export interface VaultPushResponse {
  status: number;
  sync_version?: number;
  /** WordPress REST error code when status is 4xx (e.g. complex_patient_unrecognized_vault_type). */
  errorCode?: string;
  /** Human-readable server rejection reason. */
  errorMessage?: string;
  /** Field named in a validation error, when present. */
  errorField?: string;
}

/**
 * The normalized result of a `GET /vault/{vault_type}` call.
 *
 * On a 200 the server returns the current stored optimistic-concurrency token
 * plus the blind encrypted envelope (Requirement 6.2). The conflict-resolution
 * protocol (Requirement 8.1) uses this to fetch the latest blob after a 409.
 */
export interface VaultGetResponse {
  status: number;
  sync_version?: number;
  iv?: string;
  auth_tag?: string;
  ciphertext?: string;
}

/**
 * HTTP client seam. Implementations perform the actual `POST` to
 * `/wp-json/complex-patient/v1/vault/{vault_type}`. A rejected promise is
 * treated as a transient failure and retried (Requirement 5.8).
 *
 * `getVault` is the additive read capability used by the 409 conflict-resolution
 * protocol (task 8.7) to fetch the latest blob (Requirement 8.1). It is optional
 * so a client used only for pushing remains valid; the conflict resolver
 * requires a client that implements it.
 */
export interface VaultHttpClient {
  postVault(vaultType: VaultType, payload: VaultPushPayload): Promise<VaultPushResponse>;
  getVault?(vaultType: VaultType): Promise<VaultGetResponse>;
}

/**
 * The slice of the Local_Vault the worker depends on. The worker only reads
 * partition blobs; it never mutates the Local_Vault on a failed push, which is
 * how the "retain the affected Vault_Blob unchanged" guarantee is met
 * (Requirement 5.8).
 */
export interface VaultReader {
  readPartition(vaultType: VaultType): Promise<VaultBlob | null>;
}

/** Opaque handle returned by {@link Timer.setTimeout}. */
export type TimerHandle = unknown;

/**
 * Timer/clock seam so connectivity-triggered scheduling is testable without
 * real timers. A trivial production adapter wraps the global `setTimeout` /
 * `clearTimeout`.
 */
export interface Timer {
  setTimeout(handler: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/**
 * A real-timer adapter backed by the host `setTimeout`/`clearTimeout`.
 */
export const realTimer: Timer = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Seam for the HTTP 409 conflict-resolution protocol (Requirement 8).
 *
 * This is intentionally a placeholder hook for task 8.7. When a push returns
 * 409, `syncPartition` delegates here with the server's current stored version
 * and returns whatever outcome the resolver produces. The default
 * implementation does not attempt a merge and reports `conflict-failed`.
 */
export type ConflictResolver = (
  vaultType: VaultType,
  remoteSyncVersion: number | undefined,
) => Promise<SyncOutcome>;

/**
 * Default conflict resolver placeholder.
 *
 * Task 8.7 replaces this with the fetch → decrypt/verify → three-way-merge →
 * re-encrypt → re-push cycle. Until then it leaves the Local_Vault unchanged
 * and reports that the conflict was not resolved.
 */
const defaultConflictResolver: ConflictResolver = async () => ({ status: 'conflict-failed' });

/**
 * Constructor dependencies for {@link SyncWorker}.
 */
export interface SyncWorkerDeps {
  /** HTTP client performing the vault POST. */
  http: VaultHttpClient;
  /** Local_Vault reader supplying the blob to push. */
  vault: VaultReader;
  /** Timer seam; defaults to {@link realTimer}. */
  timer?: Timer;
  /**
   * Delay before connectivity-triggered sync begins. Must be within the
   * 30-second window (Requirement 5.7). Defaults to 0 (begin promptly).
   */
  connectivitySyncDelayMs?: number;
  /** Maximum push attempts before surfacing "pending". Defaults to 5. */
  maxAttempts?: number;
  /** 409 conflict-resolution seam (task 8.7). */
  resolveConflict?: ConflictResolver;
  /**
   * Surface a "sync pending" indication to the user after the final failed
   * attempt (Requirement 5.8). Optional; the pending state is also queryable via
   * {@link SyncWorker.isPending}.
   */
  onSyncPending?: (vaultType: VaultType, attempts: number) => void;
}

/** WordPress rejects vault types the deployed plugin does not yet recognize. */
export const UNRECOGNIZED_VAULT_TYPE_ERROR = 'complex_patient_unrecognized_vault_type';

function isUnsupportedVaultTypeResponse(response: VaultPushResponse): boolean {
  return response.status === 400 && response.errorCode === UNRECOGNIZED_VAULT_TYPE_ERROR;
}

function isNonRetryableTransportError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return /not authenticated/i.test(message);
}

function formatPushFailure(response: VaultPushResponse | null, vaultType: VaultType): string {
  if (response === null) {
    return `[SyncWorker] push for ${vaultType} failed (network error)`;
  }
  const detail = response.errorMessage
    ? `: ${response.errorMessage}`
    : response.errorField
      ? ` (field: ${response.errorField})`
      : '';
  return `[SyncWorker] push for ${vaultType} failed with HTTP ${response.status}${detail}`;
}

/**
 * The background Sync_Worker.
 */
export class SyncWorker {
  private readonly http: VaultHttpClient;
  private readonly vault: VaultReader;
  private readonly timer: Timer;
  private readonly connectivitySyncDelayMs: number;
  private readonly maxAttempts: number;
  private readonly resolveConflict: ConflictResolver;
  private readonly onSyncPending?: (vaultType: VaultType, attempts: number) => void;

  /** Partitions with unsynced local changes awaiting a push (Requirement 5.6). */
  private readonly queue = new Set<VaultType>();
  /** Partitions whose sync is pending after exhausting retries (Requirement 5.8). */
  private readonly pending = new Set<VaultType>();
  /**
   * Partitions the Sync_Backend permanently rejects (e.g. unrecognized vault_type
   * on an older WordPress deploy). Kept locally only; not retried every sync.
   */
  private readonly unsupportedOnServer = new Set<VaultType>();
  /** Pending connectivity-triggered scheduling handle, if any. */
  private connectivityHandle: TimerHandle | null = null;

  constructor(deps: SyncWorkerDeps) {
    const delay = deps.connectivitySyncDelayMs ?? 0;
    if (!Number.isFinite(delay) || delay < 0 || delay > CONNECTIVITY_SYNC_WINDOW_MS) {
      throw new RangeError(
        `connectivitySyncDelayMs must be within [0, ${CONNECTIVITY_SYNC_WINDOW_MS}] to satisfy Requirement 5.7`,
      );
    }
    const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError('maxAttempts must be a positive integer');
    }

    this.http = deps.http;
    this.vault = deps.vault;
    this.timer = deps.timer ?? realTimer;
    this.connectivitySyncDelayMs = delay;
    this.maxAttempts = maxAttempts;
    this.resolveConflict = deps.resolveConflict ?? defaultConflictResolver;
    this.onSyncPending = deps.onSyncPending;
  }

  /**
   * Record that a partition has unsynced local changes (Requirement 5.6).
   * Enqueuing is idempotent — a partition is queued at most once.
   */
  enqueue(vaultType: VaultType): void {
    if (this.unsupportedOnServer.has(vaultType)) {
      return;
    }
    this.queue.add(vaultType);
    // A fresh local change clears any stale "pending" indication; the partition
    // will be attempted again on the next sync pass.
    this.pending.delete(vaultType);
  }

  /**
   * Begin synchronizing the affected partitions within 30 seconds of
   * connectivity restoration (Requirement 5.7).
   *
   * The actual start is scheduled through the injected {@link Timer} with a
   * delay bounded by the 30-second window, so callers (and tests) control when
   * the sync pass runs. Repeated calls before the scheduled pass fires collapse
   * into a single pass.
   */
  onConnectivityRestored(): void {
    if (this.connectivityHandle !== null) {
      return;
    }
    this.connectivityHandle = this.timer.setTimeout(() => {
      this.connectivityHandle = null;
      // Fire-and-forget: the background pass manages its own outcomes.
      void this.syncAllQueued();
    }, this.connectivitySyncDelayMs);
  }

  /**
   * Synchronize every currently queued partition. Returns the per-partition
   * outcomes keyed by vault_type. Exposed primarily for the connectivity pass
   * and for tests; production callers typically rely on
   * {@link onConnectivityRestored}.
   */
  async syncAllQueued(): Promise<Map<VaultType, SyncOutcome>> {
    const outcomes = new Map<VaultType, SyncOutcome>();
    // Snapshot so partitions enqueued mid-pass are handled on the next pass.
    const partitions = [...this.queue];
    for (const vaultType of partitions) {
      outcomes.set(vaultType, await this.syncPartition(vaultType));
    }
    return outcomes;
  }

  /**
   * Perform `POST /vault/{vault_type}` for a single partition.
   *
   * Behavior (Requirement 5.8):
   * - On a 200 response the partition is removed from the queue and the new
   *   server version is returned as `synced`.
   * - On a 409 response the {@link ConflictResolver} seam is invoked (task 8.7).
   * - On any other failure (rejected promise or non-2xx/409 status) the push is
   *   retried up to `maxAttempts` total attempts. The Local_Vault blob is never
   *   mutated, so it is retained unchanged. After the final failed attempt the
   *   partition is marked pending, a "sync pending" indication is surfaced, and
   *   `pending` is returned with the number of attempts made.
   *
   * If there is no blob to push for the partition, it is treated as already in
   * sync and dequeued.
   */
  async syncPartition(vaultType: VaultType): Promise<SyncOutcome> {
    if (this.unsupportedOnServer.has(vaultType)) {
      this.queue.delete(vaultType);
      this.pending.delete(vaultType);
      const blob = await this.vault.readPartition(vaultType);
      return { status: 'synced', newVersion: blob?.sync_version ?? 0 };
    }

    const blob = await this.vault.readPartition(vaultType);
    if (blob === null) {
      // Nothing to push; consider the partition reconciled.
      this.queue.delete(vaultType);
      this.pending.delete(vaultType);
      return { status: 'synced', newVersion: 0 };
    }

    const payload: VaultPushPayload = {
      sync_version: blob.sync_version,
      iv: blob.iv,
      auth_tag: blob.auth_tag,
      ciphertext: blob.ciphertext,
    };

    let attempts = 0;
    let lastFailureStatus: number | null = null;
    let lastFailureResponse: VaultPushResponse | null = null;
    let lastNetworkError: string | null = null;
    while (attempts < this.maxAttempts) {
      attempts += 1;
      let response: VaultPushResponse | null = null;
      try {
        response = await this.http.postVault(vaultType, payload);
      } catch (cause) {
        // Transient failure (e.g. network drop, CORS, auth header build). Retain the
        // blob unchanged and retry until the attempt budget is exhausted.
        response = null;
        lastFailureStatus = null;
        lastFailureResponse = null;
        lastNetworkError = cause instanceof Error ? cause.message : String(cause);
      }

      if (response !== null) {
        if (response.status === 0) {
          lastFailureStatus = null;
          lastFailureResponse = response;
          lastNetworkError = response.errorMessage ?? 'network request failed before HTTP response';
          if (isNonRetryableTransportError(response.errorMessage)) {
            break;
          }
          continue;
        }

        if (response.status >= 200 && response.status < 300) {
          // Accepted by the backend; the server returns the incremented version.
          this.queue.delete(vaultType);
          this.pending.delete(vaultType);
          return {
            status: 'synced',
            newVersion: response.sync_version ?? blob.sync_version,
          };
        }

        if (response.status === 409) {
          // Version conflict: delegate to the conflict-resolution seam (8.x,
          // implemented by task 8.7). Do not count this as a retryable push
          // failure here.
          const outcome = await this.resolveConflict(vaultType, response.sync_version);
          if (outcome.status === 'conflict-resolved') {
            this.queue.delete(vaultType);
            this.pending.delete(vaultType);
          }
          return outcome;
        }

        if (isUnsupportedVaultTypeResponse(response)) {
          this.unsupportedOnServer.add(vaultType);
          this.queue.delete(vaultType);
          this.pending.delete(vaultType);
          console.warn(
            `${formatPushFailure(response, vaultType)}. ` +
              'Deploy the latest WordPress plugin to sync this partition; keeping data on device only.',
          );
          return { status: 'synced', newVersion: blob.sync_version };
        }

        lastFailureStatus = response.status;
        lastFailureResponse = response;
      }

      // Otherwise: a retryable failure. Loop again until attempts are exhausted.
    }

    // All attempts failed: retain the blob, mark pending, and surface the
    // indication to the user (Requirement 5.8).
    this.pending.add(vaultType);
    this.onSyncPending?.(vaultType, attempts);
    if (lastFailureStatus === 401 || lastFailureStatus === 403) {
      console.error(
        `${formatPushFailure(lastFailureResponse, vaultType)}. ` +
          'Check WordPress sign-in: use an Application Password from your user profile, not your login password.',
      );
    } else if (lastFailureResponse?.status === 0) {
      const detail = lastFailureResponse.errorMessage ?? lastNetworkError ?? 'network request failed';
      console.error(
        `[SyncWorker] push for ${vaultType} failed after ${attempts} attempts (transport error): ${detail}`,
      );
    } else if (lastFailureStatus !== null) {
      console.error(formatPushFailure(lastFailureResponse, vaultType));
    } else {
      const detail = lastNetworkError ? `: ${lastNetworkError}` : '';
      console.error(
        `[SyncWorker] push for ${vaultType} failed after ${attempts} attempts (network error)${detail}`,
      );
    }
    return { status: 'pending', attempts };
  }

  /** Whether a partition currently has unsynced changes queued. */
  isQueued(vaultType: VaultType): boolean {
    return this.queue.has(vaultType);
  }

  /** Whether a partition is in the "sync pending" state (Requirement 5.8). */
  isPending(vaultType: VaultType): boolean {
    return this.pending.has(vaultType);
  }
}
