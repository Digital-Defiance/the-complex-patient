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

import type { CryptoKeyRef, KdfParams, PaperBackupTemplate } from '@complex-patient/crypto-engine';
import {
  createPaperBackupWrap,
  deriveKEK,
  formatPaperBackupTemplateText,
  generatePaperBackupQrDataUrl,
  generateSalt,
  normalizePaperBackupMnemonic,
  unwrapKekFromPaperBackup,
  validatePaperBackupMnemonic,
  wrapKekForPaperBackup,
} from '@complex-patient/crypto-engine';
import { decrypt, encrypt } from '@complex-patient/crypto-engine';
import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultRecord, VaultType } from '@complex-patient/domain';
import type { SessionKeyStore } from '@complex-patient/key-store';
import type { VaultHttpClientWithKdf, DevicePushRegistration } from './vault-http-client';
import { getOrCreateDeviceId, type DeviceIdStorage } from './device-id';
import {
  kdfMaterialFromPayload,
  kdfMaterialToPayload,
  type KdfMaterial,
} from './kdf-material-sync';
import { pullRemoteVaultPartitions, recoverVaultPartitionsFromRemote, parseHydrateFailurePartition, probeKekAgainstVaultData } from './vault-pull';
import {
  createOfflineSyncCoordinator,
  type OfflineSyncCoordinator,
  type SyncWorkerLike,
} from '../store/offline-sync';
import { bindStoreToLock, type IdleController, type LockBinding } from '../store/lock-binding';
import { suspendBackgroundLock } from '../app-shell/background-lock-session';
import type { CommitResult, VaultStore } from '../store/vault-store';
import { PHI_VAULT_TYPES, type PartitionProjection } from '../store/types';
import type { MutableAuthProvider, WordPressAuth } from './auth';
import {
  listRegisteredPaperBackups,
  registerPaperBackupMnemonic,
  rekeyPaperBackupRegistry,
  unregisterPaperBackupMnemonic,
  type PaperBackupRegistryStorage,
} from './paper-backup-registry';

const PASSPHRASE_MIN_LENGTH = 12;
const PASSPHRASE_MAX_LENGTH = 128;

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
  | { ok: true; status: 'ready'; quarantinedPartitions?: VaultType[] }
  | {
      ok: false;
      reason:
        | 'NOT_AUTHENTICATED'
        | 'PASSPHRASE_REQUIRED'
        | 'NO_KEY_STORED'
        | 'BIOMETRIC_FAILED'
        | 'BIOMETRIC_LOCKED_OUT'
        | 'CORRUPT_PARTITION';
      partition?: VaultType;
    };

/** Partitions that may be auto-quarantined during unlock recovery. Core PHI requires consent. */
const AUTO_QUARANTINE_PARTITIONS: ReadonlySet<VaultType> = new Set(['locationTrail']);

export interface UnlockWithKekOptions {
  /** Quarantine these partitions before hydrate (explicit user consent). */
  quarantinePartitions?: VaultType[];
}

/** Result of a WordPress sign-in attempt. */
export type SignInResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'NETWORK_ERROR'; detail?: string };

function formatWordPressSignInDetail(response: {
  message?: string;
  code?: string;
}): string | undefined {
  if (response.code === 'rest_not_logged_in') {
    return (
      'WordPress did not receive your Application Password. Use your WordPress username (login name) and an Application Password from Users → Profile → Application Passwords — not your regular wp-admin password. Being logged into wp-admin in the browser does not sign the app in.'
    );
  }
  return response.message;
}

/** Summary of a server-stored paper backup (metadata only). */
export interface PaperBackupSummary {
  backupId: string;
  label?: string;
  createdAt: string;
}

export type CreatePaperBackupResult =
  | {
      ok: true;
      mnemonic: string;
      backupId: string;
      templateText: string;
      qrDataUrl: string;
      template: PaperBackupTemplate;
    }
  | { ok: false; reason: 'NOT_UNLOCKED' | 'NO_HTTP' | 'UPLOAD_FAILED' | 'CRYPTO_FAILED'; httpStatus?: number };

export type ChangePassphraseResult =
  | { ok: true; rewrappedBackups: number }
  | {
      ok: false;
      reason:
        | 'NOT_UNLOCKED'
        | 'PASSPHRASE_INVALID'
        | 'DERIVATION_FAILED'
        | 'REKEY_FAILED'
        | 'REWRAP_FAILED'
        | 'KDF_PUBLISH_FAILED';
    };

export type PaperBackupRecoveryResult = HomeUnlockResult | { ok: false; reason: 'INVALID_MNEMONIC' | 'NOT_FOUND' | 'DECRYPT_FAILED' | 'NOT_AUTHENTICATED' };

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
  /** Returns the active session KEK while unlocked (for background reconcile). */
  getActiveKek?: () => CryptoKeyRef | null;
  /** Persists a stable per-install device id for push registration. */
  deviceIdStorage?: DeviceIdStorage;
  /** Device-local storage for KEK-encrypted paper-backup mnemonic registry. */
  paperBackupRegistryStorage?: PaperBackupRegistryStorage;
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
  unlockWithKek(kek: CryptoKeyRef, options?: UnlockWithKekOptions): Promise<HomeUnlockResult>;

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

  /** Hint that another device updated the vault (e.g. push received while locked). */
  markRemoteReconcilePending(): void;

  /** Register this device for vault-update push notifications (non-PHI hints only). */
  registerDevicePush(
    registration: Omit<DevicePushRegistration, 'device_id'>,
  ): Promise<{ ok: boolean }>;

  /** Remove this device from vault-update push notifications. */
  unregisterDevicePush(): Promise<void>;

  /** Stable per-install device id used for push fan-out exclusion. */
  getDeviceId(): Promise<string | null>;

  /** Reset the idle countdown on user interaction (Requirement 3.7). */
  notifyActivity(): void;

  /**
   * Subscribe to {@link HomeStatus} transitions (unlock, idle lock, sign-out).
   * Used by the shell to route away from PHI screens when the vault locks.
   */
  subscribeStatus(listener: (status: HomeStatus) => void): () => void;

  /** Fetch shared KDF material from the Sync_Backend (non-secret). */
  fetchRemoteKdfMaterial(): Promise<KdfMaterial | null>;

  /** Publish local KDF material to the Sync_Backend (non-secret). */
  publishKdfMaterial(material: KdfMaterial): Promise<void>;

  /**
   * Whether `kek` decrypts any remote PHI partition. Used during unlock to pick
   * the correct KDF when server metadata drifted from the encryption key.
   */
  probeRemoteVaultDecrypt(kek: CryptoKeyRef): Promise<boolean>;

  /** Whether any encrypted PHI partition exists on this device. */
  hasExistingVaultData(): Promise<boolean>;

  /** Whether a platform quick-unlock key is stored (biometrics on native). */
  hasStoredUnlockKey(): Promise<boolean>;

  /** List active paper backup envelopes stored for this account. */
  listPaperBackups(): Promise<PaperBackupSummary[]>;

  /** Create a new paper backup wrapping the current session KEK. */
  createPaperBackup(material: KdfMaterial, label?: string): Promise<CreatePaperBackupResult>;

  /** Revoke a paper backup so it can no longer be used for recovery. */
  revokePaperBackup(backupId: string): Promise<{ ok: boolean }>;

  /**
   * Recover the vault using a paper backup mnemonic + backup id printed on the sheet.
   * Persists recovered KDF material locally before unlocking.
   */
  recoverWithPaperBackup(
    mnemonic: string,
    backupId: string,
    saveKdfMaterial: (material: KdfMaterial) => Promise<void>,
  ): Promise<PaperBackupRecoveryResult>;

  /**
   * Change the master passphrase: re-encrypt local vault partitions, publish new
   * KDF material, and re-wrap active paper backups using the device registry.
   */
  changeMasterPassphrase(
    newPassphrase: string,
    currentMaterial: KdfMaterial,
    saveKdfMaterial: (material: KdfMaterial) => Promise<void>,
  ): Promise<ChangePassphraseResult>;

  /** Web-only: whether passkey fast unlock is supported in this browser. */
  isPasskeyUnlockAvailable?(): boolean;

  /** Web-only: whether a passkey-wrapped KEK is stored on this device. */
  hasPasskeyUnlock?(): boolean;

  /** Web-only: register or refresh passkey unlock after a passphrase unlock. */
  enablePasskeyUnlock?(
    options?: { replace?: boolean },
  ): Promise<{ ok: true } | { ok: false; message: string }>;

  /** Web-only: remove saved passkey unlock metadata from this browser. */
  removePasskeyUnlock?(): void;

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
  const {
    keyStore,
    store,
    syncWorker,
    auth,
    idle,
    vault,
    vaultHttp,
    getActiveKek,
    deviceIdStorage,
    paperBackupRegistryStorage,
  } = deps;

  const coordinator = createOfflineSyncCoordinator({ store, syncWorker });
  const lock = bindStoreToLock({ store, keyStore, idle });
  let remoteReconcilePending = false;

  async function reconcileRemotePartitions(): Promise<void> {
    const kek = getActiveKek?.() ?? null;
    if (kek === null || vault === undefined || vaultHttp === undefined || auth.getAuth() === null) {
      return;
    }
    if (!store.isUnlocked()) {
      return;
    }

    try {
      await pullRemoteVaultPartitions({
        vault,
        http: vaultHttp,
        verifyDecrypt: { kek, crypto: { decrypt, encrypt } },
        onPartitionApplied: async ({ vaultType, outcome }) => {
          await store.refreshPartition(vaultType);
          if (outcome.needsPush) {
            syncWorker.enqueue(vaultType);
          }
        },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn('[HomeEntry] remote reconcile failed:', message);
    }
  }

  async function resolveDeviceId(): Promise<string | null> {
    if (deviceIdStorage === undefined) {
      return null;
    }
    return getOrCreateDeviceId(deviceIdStorage);
  }

  async function registerDevicePush(
    registration: Omit<DevicePushRegistration, 'device_id'>,
  ): Promise<{ ok: boolean }> {
    if (vaultHttp === undefined || auth.getAuth() === null) {
      return { ok: false };
    }
    const deviceId = await resolveDeviceId();
    if (deviceId === null) {
      return { ok: false };
    }
    try {
      const response = await vaultHttp.registerDevice({
        ...registration,
        device_id: deviceId,
      });
      return { ok: response.status >= 200 && response.status < 300 };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn('[HomeEntry] device push registration failed:', message);
      return { ok: false };
    }
  }

  async function unregisterDevicePush(): Promise<void> {
    if (vaultHttp === undefined || auth.getAuth() === null || deviceIdStorage === undefined) {
      return;
    }
    const deviceId = await deviceIdStorage.getDeviceId();
    if (deviceId === null || deviceId === '') {
      return;
    }
    try {
      await vaultHttp.unregisterDevice(deviceId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn('[HomeEntry] device push unregister failed:', message);
    }
  }

  async function getDeviceId(): Promise<string | null> {
    return resolveDeviceId();
  }

  async function pullBeforeHydrate(kek: CryptoKeyRef): Promise<void> {
    if (vault === undefined || vaultHttp === undefined || auth.getAuth() === null) {
      return;
    }
    try {
      await pullRemoteVaultPartitions({
        vault,
        http: vaultHttp,
        onlyIfLocalMissing: true,
        verifyDecrypt: { kek, crypto: { decrypt } },
      });
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

  async function probeRemoteVaultDecryptForUnlock(kek: CryptoKeyRef): Promise<boolean> {
    if (vaultHttp === undefined && vault === undefined) {
      return true;
    }
    return probeKekAgainstVaultData({
      vault,
      http: vaultHttp,
      kek,
      crypto: { decrypt },
    });
  }

  async function hasExistingVaultData(): Promise<boolean> {
    if (vault === undefined) {
      return false;
    }
    for (const vaultType of PHI_VAULT_TYPES) {
      const blob = await vault.readPartition(vaultType);
      if (blob !== null) {
        return true;
      }
    }
    return false;
  }

  function getStatus(): HomeStatus {
    if (auth.getAuth() === null) {
      return 'signed-out';
    }
    return store.isUnlocked() ? 'ready' : 'locked';
  }

  const statusListeners = new Set<(status: HomeStatus) => void>();
  let lastEmittedStatus: HomeStatus | null = null;

  function emitStatusIfChanged(): void {
    const next = getStatus();
    if (next === lastEmittedStatus) {
      return;
    }
    lastEmittedStatus = next;
    for (const listener of statusListeners) {
      listener(next);
    }
  }

  function subscribeStatus(listener: (status: HomeStatus) => void): () => void {
    statusListeners.add(listener);
    listener(getStatus());
    return () => {
      statusListeners.delete(listener);
    };
  }

  store.subscribe(() => {
    emitStatusIfChanged();
  });

  function signIn(credential: WordPressAuth): Promise<SignInResult> {
    auth.setAuth(credential);

    if (vaultHttp === undefined) {
      emitStatusIfChanged();
      return Promise.resolve({ ok: true });
    }

    // Validate credentials before emitting `locked` so the shell does not route
    // to unlock while validation is still in flight (avoids mid-unlock sign-out).
    const validate =
      vaultHttp.validateWordPressAuth?.bind(vaultHttp) ??
      (() =>
        vaultHttp.getKdfMaterial().then((response) => ({
          status: response.status,
        })));

    return validate()
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          auth.setAuth(null);
          emitStatusIfChanged();
          console.error('[HomeEntry] signIn validation failed:', response.status, response.message);
          return {
            ok: false as const,
            reason: 'INVALID_CREDENTIALS' as const,
            detail: formatWordPressSignInDetail(response),
          };
        }
        if (response.status === 0) {
          auth.setAuth(null);
          emitStatusIfChanged();
          console.error('[HomeEntry] signIn validation failed: could not reach sync backend');
          return { ok: false as const, reason: 'NETWORK_ERROR' as const };
        }
        if (response.status !== 404 && (response.status < 200 || response.status >= 300)) {
          auth.setAuth(null);
          emitStatusIfChanged();
          console.error(`[HomeEntry] signIn validation failed: HTTP ${response.status}`);
          return { ok: false as const, reason: 'NETWORK_ERROR' as const };
        }
        emitStatusIfChanged();
        return { ok: true as const };
      })
      .catch((cause) => {
        auth.setAuth(null);
        emitStatusIfChanged();
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error('[HomeEntry] signIn validation failed:', message);
        return { ok: false as const, reason: 'NETWORK_ERROR' as const };
      });
  }

  async function signOut(): Promise<void> {
    await unregisterDevicePush();
    // Lock first so PHI projections + KEK are discarded together, then drop the
    // backend credential (Requirements 3.6, 4.8).
    await lock.lock();
    auth.setAuth(null);
    emitStatusIfChanged();
  }

  async function hydrateWithPartitionRescue(
    kek: CryptoKeyRef,
    preQuarantine: VaultType[] = [],
  ): Promise<HomeUnlockResult> {
    const quarantinedPartitions: VaultType[] = [];

    if (vault !== undefined) {
      for (const vaultType of preQuarantine) {
        if (!PHI_VAULT_TYPES.includes(vaultType)) {
          continue;
        }
        console.warn(`[HomeEntry] quarantining partition before hydrate: ${vaultType}`);
        await vault.quarantinePartition(vaultType);
        quarantinedPartitions.push(vaultType);
      }
    }

    for (let attempt = 0; attempt < PHI_VAULT_TYPES.length; attempt += 1) {
      try {
        await store.hydrate(kek);
        lock.startIdleTimer();
        // Pull remote changes (merge) then push any queued local writes.
        onConnectivityRestored();
        remoteReconcilePending = false;
        if (quarantinedPartitions.length > 0) {
          console.warn(
            '[HomeEntry] unlocked after quarantining undecryptable partitions:',
            quarantinedPartitions.join(', '),
          );
        }
        return {
          ok: true,
          status: 'ready',
          quarantinedPartitions: quarantinedPartitions.length > 0 ? quarantinedPartitions : undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const partitionName = parseHydrateFailurePartition(message);
        if (!partitionName || vault === undefined) {
          throw error;
        }
        if (!PHI_VAULT_TYPES.includes(partitionName as VaultType)) {
          throw error;
        }
        const vaultType = partitionName as VaultType;
        if (quarantinedPartitions.includes(vaultType)) {
          throw error;
        }
        if (!AUTO_QUARANTINE_PARTITIONS.has(vaultType)) {
          return { ok: false, reason: 'CORRUPT_PARTITION', partition: vaultType };
        }
        console.warn(`[HomeEntry] quarantining optional undecryptable partition: ${vaultType}`);
        await vault.quarantinePartition(vaultType);
        quarantinedPartitions.push(vaultType);
      }
    }

    throw new Error('hydrate failed after quarantining all corrupt partitions');
  }

  async function hydrateReady(kek: CryptoKeyRef, preQuarantine: VaultType[] = []): Promise<HomeUnlockResult> {
    try {
      await pullBeforeHydrate(kek);
      return await hydrateWithPartitionRescue(kek, preQuarantine);
    } catch (firstError) {
      if (vault !== undefined && vaultHttp !== undefined) {
        try {
          console.warn('[HomeEntry] local hydrate failed; attempting remote recovery…');
          await recoverVaultPartitionsFromRemote({
            vault,
            http: vaultHttp,
            verifyDecrypt: { kek, crypto: { decrypt } },
          });
          return await hydrateWithPartitionRescue(kek, preQuarantine);
        } catch (retryError) {
          const message = retryError instanceof Error ? retryError.message : String(retryError);
          console.error('[HomeEntry] hydrate failed after remote recovery:', message);
          return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
        }
      }

      const message = firstError instanceof Error ? firstError.message : String(firstError);
      console.error('[HomeEntry] hydrate failed:', message);
      return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
    }
  }

  async function unlockWithKek(
    kek: CryptoKeyRef,
    options?: UnlockWithKekOptions,
  ): Promise<HomeUnlockResult> {
    if (auth.getAuth() === null) {
      return { ok: false, reason: 'NOT_AUTHENTICATED' };
    }
    const endBackgroundLockSuspension = suspendBackgroundLock();
    try {
      await keyStore.store(kek);
      const result = await hydrateReady(kek, options?.quarantinePartitions ?? []);
      if (!result.ok) {
        await keyStore.lock();
      }
      return result;
    } catch (cause) {
      await keyStore.lock().catch(() => {});
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] unlockWithKek failed:', message);
      return { ok: false, reason: 'PASSPHRASE_REQUIRED' };
    } finally {
      endBackgroundLockSuspension();
    }
  }

  async function unlock(): Promise<HomeUnlockResult> {
    if (auth.getAuth() === null) {
      return { ok: false, reason: 'NOT_AUTHENTICATED' };
    }
    const endBackgroundLockSuspension = suspendBackgroundLock();
    try {
      const result = await keyStore.unlock();
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      return hydrateReady(result.kek);
    } finally {
      endBackgroundLockSuspension();
    }
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
    void reconcileRemotePartitions().finally(() => {
      coordinator.onConnectivityRestored();
    });
  }

  function markRemoteReconcilePending(): void {
    remoteReconcilePending = true;
    console.info('[HomeEntry] remote vault update pending — will reconcile on unlock');
  }

  function notifyActivity(): void {
    lock.notifyActivity();
  }

  type PasskeyCapableKeyStore = SessionKeyStore & {
    isPasskeyUnlockAvailable?: () => boolean;
    hasPasskeyUnlock?: () => boolean;
    enablePasskeyUnlock?: (
      options?: { replace?: boolean },
    ) => Promise<{ ok: true } | { ok: false; message: string }>;
    removePasskeyUnlock?: () => void;
    clearPasskeyUnlock?: () => void;
    hasStoredUnlockKey?: () => Promise<boolean>;
  };

  const passkeyKeyStore = keyStore as PasskeyCapableKeyStore;

  function isPasskeyUnlockAvailable(): boolean {
    return passkeyKeyStore.isPasskeyUnlockAvailable?.() ?? false;
  }

  function hasPasskeyUnlock(): boolean {
    return passkeyKeyStore.hasPasskeyUnlock?.() ?? false;
  }

  async function enablePasskeyUnlock(
    options?: { replace?: boolean },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!passkeyKeyStore.enablePasskeyUnlock) {
      return { ok: false, message: 'Passkey unlock is not available on this platform.' };
    }
    return passkeyKeyStore.enablePasskeyUnlock(options);
  }

  function removePasskeyUnlock(): void {
    passkeyKeyStore.removePasskeyUnlock?.() ?? passkeyKeyStore.clearPasskeyUnlock?.();
  }

  async function hasStoredUnlockKey(): Promise<boolean> {
    if (passkeyKeyStore.hasStoredUnlockKey) {
      return passkeyKeyStore.hasStoredUnlockKey();
    }
    return false;
  }

  async function listPaperBackups(): Promise<PaperBackupSummary[]> {
    if (vaultHttp === undefined || auth.getAuth() === null) {
      return [];
    }
    const response = await vaultHttp.listPaperBackups();
    if (response.status < 200 || response.status >= 300 || !response.backups) {
      return [];
    }
    return response.backups.map((entry) => ({
      backupId: entry.backup_id,
      label: entry.label ?? undefined,
      createdAt: entry.created_at,
    }));
  }

  async function createPaperBackup(
    material: KdfMaterial,
    label?: string,
  ): Promise<CreatePaperBackupResult> {
    const kek = getActiveKek?.() ?? null;
    if (kek === null || !store.isUnlocked()) {
      return { ok: false, reason: 'NOT_UNLOCKED' };
    }
    if (vaultHttp === undefined) {
      return { ok: false, reason: 'NO_HTTP' };
    }
    if (auth.getAuth() === null) {
      return { ok: false, reason: 'UPLOAD_FAILED', httpStatus: 401 };
    }

    let mnemonic: string;
    let wrapped: Awaited<ReturnType<typeof createPaperBackupWrap>>['wrapped'];
    let template: Awaited<ReturnType<typeof createPaperBackupWrap>>['template'];
    let backupId: string;

    try {
      const created = await createPaperBackupWrap(kek, {
        salt: material.salt,
        params: material.params,
      });
      mnemonic = created.mnemonic;
      wrapped = created.wrapped;
      template = created.template;
      backupId = created.backupId;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] paper backup wrap failed:', message);
      return { ok: false, reason: 'CRYPTO_FAILED' };
    }

    const response = await vaultHttp.createPaperBackup({
      backup_id: backupId,
      label,
      iv: wrapped.iv,
      auth_tag: wrapped.authTag,
      ciphertext: wrapped.ciphertext,
    });

    if (response.status < 200 || response.status >= 300) {
      console.error(
        '[HomeEntry] paper backup upload failed:',
        `HTTP ${response.status}`,
        { backupId },
      );
      return { ok: false, reason: 'UPLOAD_FAILED', httpStatus: response.status };
    }

    const templateWithLabel = { ...template, label };
    if (paperBackupRegistryStorage) {
      try {
        await registerPaperBackupMnemonic(paperBackupRegistryStorage, kek, {
          backupId,
          mnemonic,
          label,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error('[HomeEntry] paper backup registry write failed:', message);
      }
    }

    let qrDataUrl: string;
    try {
      qrDataUrl = generatePaperBackupQrDataUrl(backupId, mnemonic);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] paper backup QR render failed:', message);
      qrDataUrl = '';
    }

    return {
      ok: true,
      mnemonic,
      backupId,
      templateText: formatPaperBackupTemplateText(templateWithLabel),
      qrDataUrl,
      template: templateWithLabel,
    };
  }

  async function revokePaperBackup(backupId: string): Promise<{ ok: boolean }> {
    if (vaultHttp === undefined || auth.getAuth() === null) {
      return { ok: false };
    }
    const response = await vaultHttp.revokePaperBackup(backupId);
    if (response.status >= 200 && response.status < 300) {
      const kek = getActiveKek?.() ?? null;
      if (kek !== null && paperBackupRegistryStorage) {
        await unregisterPaperBackupMnemonic(paperBackupRegistryStorage, kek, backupId);
      }
      return { ok: true };
    }
    return { ok: false };
  }

  async function rewrapPaperBackups(
    oldKek: CryptoKeyRef,
    newKek: CryptoKeyRef,
    material: KdfMaterial,
  ): Promise<number> {
    if (vaultHttp === undefined || paperBackupRegistryStorage === undefined) {
      return 0;
    }

    await rekeyPaperBackupRegistry(paperBackupRegistryStorage, oldKek, newKek);
    const entries = await listRegisteredPaperBackups(paperBackupRegistryStorage, newKek);
    let updated = 0;

    for (const entry of entries) {
      const wrapped = await wrapKekForPaperBackup(entry.mnemonic, newKek, {
        salt: material.salt,
        params: material.params,
      });
      const response = await vaultHttp.updatePaperBackup(entry.backupId, {
        iv: wrapped.iv,
        auth_tag: wrapped.authTag,
        ciphertext: wrapped.ciphertext,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`failed to re-wrap paper backup ${entry.backupId}`);
      }
      updated += 1;
    }

    return updated;
  }

  async function changeMasterPassphrase(
    newPassphrase: string,
    currentMaterial: KdfMaterial,
    saveKdfMaterial: (material: KdfMaterial) => Promise<void>,
  ): Promise<ChangePassphraseResult> {
    if (
      newPassphrase.length < PASSPHRASE_MIN_LENGTH ||
      newPassphrase.length > PASSPHRASE_MAX_LENGTH
    ) {
      return { ok: false, reason: 'PASSPHRASE_INVALID' };
    }

    const oldKek = getActiveKek?.() ?? null;
    if (oldKek === null || !store.isUnlocked()) {
      return { ok: false, reason: 'NOT_UNLOCKED' };
    }

    const newSalt = await generateSalt();
    const newMaterial: KdfMaterial = {
      salt: newSalt,
      params: currentMaterial.params,
    };

    const derived = await deriveKEK(newPassphrase, newMaterial.salt, newMaterial.params);
    if (!derived.ok) {
      return { ok: false, reason: 'DERIVATION_FAILED' };
    }

    try {
      await store.rekey(derived.kek);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] vault rekey failed:', message);
      return { ok: false, reason: 'REKEY_FAILED' };
    }

    let rewrappedBackups = 0;
    try {
      rewrappedBackups = await rewrapPaperBackups(oldKek, derived.kek, newMaterial);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] paper backup re-wrap failed:', message);
      return { ok: false, reason: 'REWRAP_FAILED' };
    }

    await keyStore.store(derived.kek);
    await saveKdfMaterial(newMaterial);

    try {
      await publishKdfMaterial(newMaterial);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[HomeEntry] KDF publish failed after passphrase change:', message);
      return { ok: false, reason: 'KDF_PUBLISH_FAILED' };
    }

    for (const vaultType of PHI_VAULT_TYPES) {
      syncWorker.enqueue(vaultType);
    }

    return { ok: true, rewrappedBackups };
  }

  async function recoverWithPaperBackup(
    mnemonic: string,
    backupId: string,
    saveKdfMaterial: (material: KdfMaterial) => Promise<void>,
  ): Promise<PaperBackupRecoveryResult> {
    if (auth.getAuth() === null) {
      return { ok: false, reason: 'NOT_AUTHENTICATED' };
    }
    if (!validatePaperBackupMnemonic(mnemonic)) {
      return { ok: false, reason: 'INVALID_MNEMONIC' };
    }
    if (vaultHttp === undefined) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const response = await vaultHttp.getPaperBackup(backupId);
    if (response.status === 404) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !response.iv ||
      !response.auth_tag ||
      !response.ciphertext
    ) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    let recovered;
    try {
      recovered = await unwrapKekFromPaperBackup(normalizePaperBackupMnemonic(mnemonic), {
        iv: response.iv,
        authTag: response.auth_tag,
        ciphertext: response.ciphertext,
      });
    } catch {
      return { ok: false, reason: 'DECRYPT_FAILED' };
    }

    const material: KdfMaterial = {
      salt: recovered.salt,
      params: recovered.params,
    };
    await saveKdfMaterial(material);
    return unlockWithKek(recovered.kek);
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
    markRemoteReconcilePending,
    registerDevicePush,
    unregisterDevicePush,
    getDeviceId,
    notifyActivity,
    subscribeStatus,
    fetchRemoteKdfMaterial,
    publishKdfMaterial,
    probeRemoteVaultDecrypt: probeRemoteVaultDecryptForUnlock,
    hasExistingVaultData,
    hasStoredUnlockKey,
    listPaperBackups,
    createPaperBackup,
    revokePaperBackup,
    recoverWithPaperBackup,
    changeMasterPassphrase,
    isPasskeyUnlockAvailable,
    hasPasskeyUnlock,
    enablePasskeyUnlock,
    removePasskeyUnlock,
    dispose,
  };
}
