/**
 * @complex-patient/ui — Shared authenticated-home composition root
 *
 * Task 15.3 wires the authentication + platform entry points. Both the mobile
 * (Expo Router) and web (React Native Web) targets present the SAME
 * authenticated home interface from this shared codebase, guaranteeing
 * identical feature parity across iOS, Android, and web (Requirements 22.1,
 * 22.2). The only differences between platforms are injected adapters (Secure
 * Enclave vs volatile RAM key store, expo-notifications vs DOM badge, etc.) —
 * never the feature surface.
 *
 * This module is the platform-agnostic glue that binds together the pieces the
 * earlier tasks built:
 * - the {@link SessionKeyStore} (task 10.1) that guards the in-memory KEK,
 * - the {@link VaultStore} (task 15.1) mirroring the decrypted Local_Vault,
 * - the {@link OfflineSyncCoordinator} (task 15.2) for offline-first read/write,
 * - the authenticated blind {@link VaultHttpClient} talking to the Sync_Backend
 *   using a WordPress JWT / Application Password credential (Requirement 4.1).
 *
 * The app entry points (`apps/mobile`, `apps/web`) construct this with their
 * platform adapters and render the returned controller's state.
 */

import type { CryptoKeyRef, KdfParams } from '@complex-patient/crypto-engine';
import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { SessionKeyStore } from '@complex-patient/key-store';
import type { VaultHttpClientWithKdf } from './vault-http-client';
import {
  kdfMaterialFromPayload,
  kdfMaterialToPayload,
  type KdfMaterial,
} from './kdf-material-sync';
import { pullRemoteVaultPartitions } from './vault-pull';
import {
  createOfflineSyncCoordinator,
  type OfflineSyncCoordinator,
  type SyncWorkerLike,
} from '../store/offline-sync';
import { bindStoreToLock, type IdleController, type LockBinding } from '../store/lock-binding';
import type { CommitResult, VaultStore } from '../store/vault-store';
import type { PartitionProjection } from '../store/types';
import type { MutableAuthProvider, WordPressAuth } from './auth';

/**
 * Whether the authenticated home is currently presentable.
 *
 * - `signed-out`: no WordPress credential; the sign-in screen is shown.
 * - `locked`: authenticated to the backend, but the vault KEK is not in memory
 *   (fresh launch, idle timeout, tab reload) — the unlock screen is shown
 *   (Requirements 3.6, 3.7, 3.8).
 * - `ready`: authenticated AND unlocked; the home interface renders from the
 *   decrypted Local_Vault projection (Requirements 5.2, 22.1).
 */
export type HomeStatus = 'signed-out' | 'locked' | 'ready';

/** Result of an unlock attempt surfaced to the entry-point UI. */
export type HomeUnlockResult =
  | { ok: true; status: 'ready' }
  | { ok: false; reason: 'NOT_AUTHENTICATED' | 'PASSPHRASE_REQUIRED' | 'NO_KEY_STORED' | 'BIOMETRIC_FAILED' | 'BIOMETRIC_LOCKED_OUT' };

/** Result of a WordPress sign-in attempt. */
export type SignInResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'NETWORK_ERROR' };

/**
 * Dependencies for {@link createHomeEntry}. Every collaborator is injected so
 * the same composition runs identically on native and web — the platform only
 * varies the concrete adapters it passes in.
 */
export interface HomeEntryDeps {
  /** Platform Session Key Store guarding the KEK (native enclave / web RAM). */
  keyStore: SessionKeyStore;
  /** Vault store mirroring decrypted partitions (task 15.1). */
  store: VaultStore;
  /** Background Sync_Worker bridging Local_Vault ↔ Sync_Backend. */
  syncWorker: SyncWorkerLike;
  /** Mutable WordPress credential holder (Requirement 4.1). */
  auth: MutableAuthProvider;
  /** Encrypted Local_Vault backing store (for pull-before-hydrate). */
  vault?: LocalVault;
  /** Authenticated Sync_Backend client (KDF + partition GET). */
  vaultHttp?: VaultHttpClientWithKdf;
  /** Optional shared idle auto-lock controller (Requirement 3.7). */
  idle?: IdleController;
}

/**
 * The platform-agnostic home controller the entry points drive. It exposes the
 * full feature surface (read/commit/sync) plus the auth + lock lifecycle, so
 * both apps render from an identical API (Requirement 22.2).
 */
export interface HomeEntryController {
  /** The offline-first coordinator (read/commit/sync indications). */
  readonly coordinator: OfflineSyncCoordinator;
  /** The lock binding (clears PHI + KEK together on lock/idle). */
  readonly lock: LockBinding;

  /** Current presentable status of the authenticated home. */
  getStatus(): HomeStatus;

  /**
   * Record a successful WordPress sign-in (Requirement 4.1). Validates the
   * credential against the Sync_Backend before accepting it. Does NOT unlock
   * the vault — the KEK is established separately via {@link unlock}.
   */
  signIn(auth: WordPressAuth): Promise<SignInResult>;

  /**
   * Sign out: clear the WordPress credential and lock the vault so no PHI or KEK
   * survives the session (Requirements 4.8, 3.6).
   */
  signOut(): Promise<void>;

  /**
   * Establish the session KEK after passphrase derivation (first launch /
   * passphrase re-entry). Stores it in the platform key store and hydrates the
   * decrypted projection so the home can render (Requirements 5.1, 5.2).
   */
  unlockWithKek(kek: CryptoKeyRef): Promise<HomeUnlockResult>;

  /**
   * Attempt to unlock via the platform key store challenge (biometric on
   * native; resident RAM key on web). On success the store is hydrated and the
   * home becomes `ready` (Requirements 3.2, 3.5). On failure the reason tells
   * the UI whether to fall back to Master_Passphrase re-entry (Requirements
   * 3.3, 3.4, 3.8).
   */
  unlock(): Promise<HomeUnlockResult>;

  /** Local-only partition read for the UI (never blocks on network, 5.2). */
  read<T extends VaultRecord>(vaultType: VaultType): PartitionProjection & { records: T[] };

  /** Offline-first create/update/delete write-through (Requirements 5.3, 5.4). */
  commit<T extends VaultRecord>(
    vaultType: VaultType,
    mutator: (current: T[]) => T[],
  ): Promise<CommitResult<T>>;

  /** Forward connectivity restoration to the Sync_Worker (Requirement 5.7). */
  onConnectivityRestored(): void;

  /** Reset the idle countdown on user interaction (Requirement 3.7). */
  notifyActivity(): void;

  /** Fetch shared KDF material from the Sync_Backend (non-secret). */
  fetchRemoteKdfMaterial(): Promise<KdfMaterial | null>;

  /** Publish local KDF material to the Sync_Backend (non-secret). */
  publishKdfMaterial(material: KdfMaterial): Promise<void>;

  /** Tear down internal subscriptions. */
  dispose(): void;
}

/**
 * Compose the shared authenticated-home controller from platform adapters. This
 * is the single source of the home wiring that both `apps/mobile` and
 * `apps/web` build on, so the feature surface is provably identical across
 * platforms (Requirement 22.2).
 */
export function createHomeEntry(deps: HomeEntryDeps): HomeEntryController {
  const { keyStore, store, syncWorker, auth, idle, vault, vaultHttp } = deps;

  const coordinator = createOfflineSyncCoordinator({ store, syncWorker });
  const lock = bindStoreToLock({ store, keyStore, idle });

  async function pullBeforeHydrate(): Promise<void> {
    if (vault === undefined || vaultHttp === undefined || auth.getAuth() === null) {
      return;
    }
    try {
      await pullRemoteVaultPartitions({ vault, http: vaultHttp });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn('[HomeEntry] pull before hydrate failed:', message);
    }
  }

  async function fetchRemoteKdfMaterial(): Promise<KdfMaterial | null> {
    if (vaultHttp === undefined || auth.getAuth() === null) {
      return null;
    }
    const response = await vaultHttp.getKdfMaterial();
    if (response.status === 404) {
      return null;
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !response.salt_base64 ||
      !response.params
    ) {
      return null;
    }
    return kdfMaterialFromPayload({
      salt_base64: response.salt_base64,
      params: response.params,
    });
  }

  async function publishKdfMaterial(material: KdfMaterial): Promise<void> {
    if (vaultHttp === undefined || auth.getAuth() === null) {
      return;
    }
    const payload = kdfMaterialToPayload(material);
    const response = await vaultHttp.putKdfMaterial(payload);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`failed to publish KDF material (HTTP ${response.status})`);
    }
  }

  function getStatus(): HomeStatus {
    if (auth.getAuth() === null) {
      return 'signed-out';
    }
    return store.isUnlocked() ? 'ready' : 'locked';
  }

  function signIn(credential: WordPressAuth): Promise<SignInResult> {
    auth.setAuth(credential);

    if (vaultHttp === undefined) {
      return Promise.resolve({ ok: true });
    }

    return vaultHttp
      .getKdfMaterial()
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          auth.setAuth(null);
          return { ok: false as const, reason: 'INVALID_CREDENTIALS' as const };
        }
        return { ok: true as const };
      })
      .catch((cause) => {
        auth.setAuth(null);
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error('[HomeEntry] signIn validation failed:', message);
        return { ok: false as const, reason: 'NETWORK_ERROR' as const };
      });
  }

  async function signOut(): Promise<void> {
    // Lock first so PHI projections + KEK are discarded together, then drop the
    // backend credential (Requirements 3.6, 4.8).
    await lock.lock();
    auth.setAuth(null);
  }

  async function hydrateReady(kek: CryptoKeyRef): Promise<HomeUnlockResult> {
    try {
      await pullBeforeHydrate();
      await store.hydrate(kek);
      lock.startIdleTimer();
      return { ok: true, status: 'ready' };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] hydrate failed:', message);
      return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
    }
  }

  async function unlockWithKek(kek: CryptoKeyRef): Promise<HomeUnlockResult> {
    if (auth.getAuth() === null) {
      return { ok: false, reason: 'NOT_AUTHENTICATED' };
    }
    try {
      await keyStore.store(kek);
      return await hydrateReady(kek);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] unlockWithKek failed:', message);
      return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
    }
  }

  async function unlock(): Promise<HomeUnlockResult> {
    if (auth.getAuth() === null) {
      return { ok: false, reason: 'NOT_AUTHENTICATED' };
    }
    const result = await keyStore.unlock();
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    return hydrateReady(result.kek);
  }

  function read<T extends VaultRecord>(vaultType: VaultType) {
    return coordinator.read<T>(vaultType);
  }

  function commit<T extends VaultRecord>(
    vaultType: VaultType,
    mutator: (current: T[]) => T[],
  ): Promise<CommitResult<T>> {
    return coordinator.commit<T>(vaultType, mutator);
  }

  function onConnectivityRestored(): void {
    coordinator.onConnectivityRestored();
  }

  function notifyActivity(): void {
    lock.notifyActivity();
  }

  function dispose(): void {
    coordinator.dispose();
  }

  return {
    coordinator,
    lock,
    getStatus,
    signIn,
    signOut,
    unlockWithKek,
    unlock,
    read,
    commit,
    onConnectivityRestored,
    notifyActivity,
    fetchRemoteKdfMaterial,
    publishKdfMaterial,
    dispose,
  };
}
