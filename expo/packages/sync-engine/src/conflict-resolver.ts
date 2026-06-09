/**
 * HTTP 409 conflict-resolution protocol (Requirement 8).
 *
 * When a `POST /vault/{vault_type}` is rejected with HTTP 409 Conflict, the
 * Sync_Worker delegates to a {@link ConflictResolver}. This module builds that
 * resolver from injected collaborators — an HTTP client (fetch + push), the
 * Local_Vault (local records, the last common synced base, and write-back), the
 * Crypto_Engine (decrypt/verify + re-encrypt), and the unlocked KEK — so the
 * full protocol can be exercised under vitest with no real network or timers.
 *
 * The protocol (one cycle) is:
 *   1. Fetch the latest remote Vault_Blob for the partition within 10 seconds
 *      (Requirement 8.1). On fetch failure or timeout, abort and retain all
 *      unsynced local records unchanged (Requirement 8.2).
 *   2. Decrypt and integrity-verify the fetched blob on-device via the
 *      Crypto_Engine (Requirement 8.3). On decrypt/verify failure, abort and
 *      retain all unsynced local records unchanged (Requirement 8.4).
 *   3. Run the three-way {@link threeWayMerge} over (base, local, remote), then
 *      re-encrypt the merged result and re-push it — re-pushing ONLY after
 *      re-encryption has completed (Requirements 8.5, 8.8).
 *   4. If the re-push returns a further HTTP 409, re-fetch → re-merge → re-push
 *      up to 3 additional times; if all retries are exhausted, abort and retain
 *      all unsynced local records unchanged (Requirement 8.9).
 *
 * The resolver never mutates the Local_Vault on any failure path, which is how
 * the "retain all unsynced local records unchanged" guarantee is met
 * (Requirements 8.2, 8.4, 8.9). On success it persists the merged blob as the
 * new live partition and the new last-common-synced base.
 */

import type { VaultRecord, VaultType, PartitionPayload } from '@complex-patient/domain';
import type { VaultBlob } from '@complex-patient/local-vault';
import type {
  CryptoKeyRef,
  EncryptedPayload,
  DecryptResult,
} from '@complex-patient/crypto-engine';
import { threeWayMerge } from './merge';
import {
  realTimer,
  type ConflictResolver,
  type SyncOutcome,
  type Timer,
  type TimerHandle,
  type VaultGetResponse,
  type VaultPushResponse,
  type VaultPushPayload,
} from './sync-worker';

/**
 * The maximum window, in milliseconds, within which the latest-blob fetch must
 * complete after an HTTP 409 (Requirement 8.1).
 */
export const CONFLICT_FETCH_TIMEOUT_MS = 10_000;

/**
 * The number of additional re-fetch → re-merge → re-push cycles attempted when
 * a re-push itself returns a further HTTP 409 (Requirement 8.9).
 */
export const DEFAULT_CONFLICT_RETRIES = 3;

/**
 * A machine-readable reason the conflict could not be resolved. Surfaced to the
 * caller via {@link ConflictResolverDeps.onConflictError} so the UI can show the
 * appropriate message while local records are retained unchanged.
 */
export type ConflictFailureReason =
  /** The latest-blob fetch failed or did not complete within 10s (8.2). */
  | 'FETCH_FAILED'
  /** Decryption / integrity verification of the fetched blob failed (8.4). */
  | 'VERIFY_FAILED'
  /** The local partition or base blob could not be decrypted for merging. */
  | 'LOCAL_DECRYPT_FAILED'
  /** Re-encryption of the merged result failed. */
  | 'ENCRYPT_FAILED'
  /** All conflict retries were exhausted on repeated 409s (8.9). */
  | 'RETRIES_EXHAUSTED';

/**
 * The slice of the Crypto_Engine the resolver depends on. Matches the
 * `encrypt`/`decrypt` free functions exported by `@complex-patient/crypto-engine`.
 */
export interface ConflictCrypto {
  encrypt(plaintext: Uint8Array, kek: CryptoKeyRef): Promise<EncryptedPayload>;
  decrypt(blob: EncryptedPayload, kek: CryptoKeyRef): Promise<DecryptResult>;
}

/**
 * The slice of the Local_Vault the resolver depends on: it reads the unsynced
 * local records and the last common synced base, and — only on success — writes
 * back the merged partition and the new base.
 */
export interface ConflictVault {
  readPartition(vaultType: VaultType): Promise<VaultBlob | null>;
  writePartition(vaultType: VaultType, blob: VaultBlob): Promise<void>;
  readBase(vaultType: VaultType): Promise<VaultBlob | null>;
  setBase(vaultType: VaultType, blob: VaultBlob): Promise<void>;
}

/**
 * The HTTP capabilities the resolver requires: the read used to fetch the
 * latest blob (8.1) and the push used to re-submit the merged blob (8.8).
 */
export interface ConflictHttp {
  getVault(vaultType: VaultType): Promise<VaultGetResponse>;
  postVault(vaultType: VaultType, payload: VaultPushPayload): Promise<VaultPushResponse>;
}

/**
 * Constructor dependencies for {@link createConflictResolver}.
 */
export interface ConflictResolverDeps {
  /** HTTP client supplying both `getVault` (fetch) and `postVault` (re-push). */
  http: ConflictHttp;
  /** Local_Vault slice for local records, base, and success write-back. */
  vault: ConflictVault;
  /** Crypto_Engine slice for decrypt/verify and re-encrypt. */
  crypto: ConflictCrypto;
  /** The unlocked KEK used for all decrypt/encrypt operations. */
  kek: CryptoKeyRef;
  /** Fetch timeout window; defaults to {@link CONFLICT_FETCH_TIMEOUT_MS} (8.1). */
  fetchTimeoutMs?: number;
  /** Additional 409 retry cycles; defaults to {@link DEFAULT_CONFLICT_RETRIES} (8.9). */
  maxConflictRetries?: number;
  /** Timer seam used to enforce the fetch timeout; defaults to {@link realTimer}. */
  timer?: Timer;
  /** Surface a typed failure reason while retaining local records (8.2, 8.4, 8.9). */
  onConflictError?: (vaultType: VaultType, reason: ConflictFailureReason) => void;
}

/** Internal sentinel distinguishing a timeout rejection from other failures. */
class FetchTimeoutError extends Error {
  constructor() {
    super('conflict fetch timed out');
    this.name = 'FetchTimeoutError';
  }
}

/**
 * Race a promise against an injected-timer timeout. The timeout is driven by
 * the {@link Timer} seam so tests control it deterministically. The timer handle
 * is always cleared once the race settles.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timer: Timer): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const handle: TimerHandle = timer.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new FetchTimeoutError());
    }, ms);

    promise.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        timer.clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        timer.clearTimeout(handle);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Map a stored {@link VaultBlob} to the Crypto_Engine {@link EncryptedPayload}. */
function toEncryptedPayload(blob: {
  iv: string;
  auth_tag: string;
  ciphertext: string;
}): EncryptedPayload {
  return { iv: blob.iv, authTag: blob.auth_tag, ciphertext: blob.ciphertext };
}

/**
 * Decrypt + verify an encrypted envelope and parse its partition records.
 * Returns `null` when verification fails or the plaintext is not a valid
 * {@link PartitionPayload}; never returns partial plaintext (Requirements 8.3,
 * 8.4, mirroring 2.4–2.6).
 */
async function decryptRecords(
  envelope: EncryptedPayload,
  crypto: ConflictCrypto,
  kek: CryptoKeyRef,
): Promise<VaultRecord[] | null> {
  const result = await crypto.decrypt(envelope, kek);
  if (!result.ok) {
    return null;
  }
  try {
    const text = new TextDecoder().decode(result.plaintext);
    const parsed = JSON.parse(text) as PartitionPayload<VaultRecord>;
    if (parsed == null || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
      return null;
    }
    return parsed.records;
  } catch {
    return null;
  }
}

/**
 * Build the {@link ConflictResolver} that the SyncWorker invokes on HTTP 409.
 *
 * The returned function implements the full Requirement 8 protocol described in
 * the module header. It is a pure factory: all I/O happens through the injected
 * collaborators, and the Local_Vault is only mutated on a fully successful
 * re-push.
 */
export function createConflictResolver(deps: ConflictResolverDeps): ConflictResolver {
  const timer = deps.timer ?? realTimer;
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? CONFLICT_FETCH_TIMEOUT_MS;
  const maxConflictRetries = deps.maxConflictRetries ?? DEFAULT_CONFLICT_RETRIES;

  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    throw new RangeError('fetchTimeoutMs must be a positive number');
  }
  if (!Number.isInteger(maxConflictRetries) || maxConflictRetries < 0) {
    throw new RangeError('maxConflictRetries must be a non-negative integer');
  }

  const fail = (vaultType: VaultType, reason: ConflictFailureReason): SyncOutcome => {
    deps.onConflictError?.(vaultType, reason);
    return { status: 'conflict-failed' };
  };

  return async function resolveConflict(vaultType: VaultType): Promise<SyncOutcome> {
    // Decrypt the unsynced local records once. They do not change across retry
    // cycles; the remote side is what we re-fetch each cycle.
    const localBlob = await deps.vault.readPartition(vaultType);
    if (localBlob === null) {
      // Nothing local to reconcile — treat as a verification/local failure and
      // retain (there is nothing to lose).
      return fail(vaultType, 'LOCAL_DECRYPT_FAILED');
    }
    const localRecords = await decryptRecords(toEncryptedPayload(localBlob), deps.crypto, deps.kek);
    if (localRecords === null) {
      return fail(vaultType, 'LOCAL_DECRYPT_FAILED');
    }

    // The last common synced base may be absent (first sync) → treat as empty.
    const baseBlob = await deps.vault.readBase(vaultType);
    let baseRecords: VaultRecord[] = [];
    if (baseBlob !== null) {
      const decodedBase = await decryptRecords(
        toEncryptedPayload(baseBlob),
        deps.crypto,
        deps.kek,
      );
      // A corrupt/undecryptable base is non-fatal: fall back to an empty base so
      // the merge still preserves every local and remote record (8.5).
      baseRecords = decodedBase ?? [];
    }

    // Up to 1 + maxConflictRetries cycles: the initial re-push plus the
    // additional retries permitted on repeated 409s (Requirement 8.9).
    const totalCycles = maxConflictRetries + 1;
    for (let cycle = 0; cycle < totalCycles; cycle += 1) {
      // -- Step 1: fetch the latest remote blob within the timeout (8.1) ------
      let fetched: VaultGetResponse;
      try {
        fetched = await withTimeout(deps.http.getVault(vaultType), fetchTimeoutMs, timer);
      } catch {
        return fail(vaultType, 'FETCH_FAILED');
      }
      if (
        fetched.status < 200 ||
        fetched.status >= 300 ||
        typeof fetched.iv !== 'string' ||
        typeof fetched.auth_tag !== 'string' ||
        typeof fetched.ciphertext !== 'string' ||
        typeof fetched.sync_version !== 'number'
      ) {
        return fail(vaultType, 'FETCH_FAILED');
      }

      // -- Step 2: decrypt + integrity-verify the fetched blob (8.3, 8.4) -----
      const remoteRecords = await decryptRecords(
        toEncryptedPayload({
          iv: fetched.iv,
          auth_tag: fetched.auth_tag,
          ciphertext: fetched.ciphertext,
        }),
        deps.crypto,
        deps.kek,
      );
      if (remoteRecords === null) {
        return fail(vaultType, 'VERIFY_FAILED');
      }

      // -- Step 3: three-way merge, then re-encrypt BEFORE re-push (8.5, 8.8) -
      const merged = threeWayMerge(baseRecords, localRecords, remoteRecords);
      const payload: PartitionPayload<VaultRecord> = { records: merged };

      let encrypted: EncryptedPayload;
      try {
        const plaintext = new TextEncoder().encode(JSON.stringify(payload));
        encrypted = await deps.crypto.encrypt(plaintext, deps.kek);
      } catch {
        return fail(vaultType, 'ENCRYPT_FAILED');
      }

      // Re-push only after re-encryption has completed (8.8). The push overwrites
      // the version we just fetched, so we present that stored version as the
      // optimistic-concurrency token (Requirement 7.3).
      const pushPayload: VaultPushPayload = {
        sync_version: fetched.sync_version,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        ciphertext: encrypted.ciphertext,
      };

      let pushResponse: VaultPushResponse;
      try {
        pushResponse = await deps.http.postVault(vaultType, pushPayload);
      } catch {
        // A transient push failure is treated like an exhausted/abort path: the
        // local records are retained unchanged.
        return fail(vaultType, 'FETCH_FAILED');
      }

      if (pushResponse.status >= 200 && pushResponse.status < 300) {
        // Accepted: persist the merged result as the new live partition and the
        // new last-common-synced base, then report resolution.
        const newVersion = pushResponse.sync_version ?? fetched.sync_version + 1;
        const mergedBlob: VaultBlob = {
          sync_version: newVersion,
          iv: encrypted.iv,
          auth_tag: encrypted.authTag,
          ciphertext: encrypted.ciphertext,
        };
        await deps.vault.writePartition(vaultType, mergedBlob);
        await deps.vault.setBase(vaultType, mergedBlob);
        return { status: 'conflict-resolved', newVersion };
      }

      if (pushResponse.status === 409) {
        // Another concurrent write landed: loop to re-fetch → re-merge → re-push
        // (Requirement 8.9). Fall through to the next cycle.
        continue;
      }

      // Any other non-success status: abort and retain local records unchanged.
      return fail(vaultType, 'FETCH_FAILED');
    }

    // All cycles exhausted on repeated 409s (Requirement 8.9).
    return fail(vaultType, 'RETRIES_EXHAUSTED');
  };
}
