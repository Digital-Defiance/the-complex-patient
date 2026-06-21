/**
 * @complex-patient/local-vault — LocalVault implementation
 *
 * The Local_Vault is the client-side source of truth for the UI. It persists
 * encrypted {@link VaultBlob} envelopes for each `vault_type`, plus the
 * last-common-synced "base" blob used by the three-way merge.
 *
 * Guarantees:
 * - Encrypted-at-rest: only the ciphertext envelope `{ sync_version, iv,
 *   auth_tag, ciphertext }` is ever written to the backend; no plaintext PHI is
 *   handed to storage (Requirements 22.4, 5.1).
 * - Atomic writes: `writePartition` commits durably before resolving, so the
 *   change is readable on the next read with no network dependency
 *   (Requirement 5.4).
 * - Fail-closed init: if the backing store fails to open/unlock, all access is
 *   blocked, previously persisted data is left unchanged, and a
 *   `LOCAL_STORAGE_INITIALIZATION_FAILED` error is surfaced (Requirement 22.5).
 */

import type { VaultType } from '@complex-patient/domain';
import {
  LocalVaultError,
  type StorageBackend,
  type StorageNamespace,
  type VaultBlob,
} from './types';

/**
 * The Local_Vault interface from the design (see design.md → Local_Vault).
 */
export interface LocalVault {
  init(): Promise<void>;
  readPartition(vaultType: VaultType): Promise<VaultBlob | null>;
  writePartition(vaultType: VaultType, blob: VaultBlob): Promise<void>;
  /** Remove a persisted partition blob so reads return null. */
  clearPartition(vaultType: VaultType): Promise<void>;
  /**
   * Move a partition blob to quarantine storage so unlock can proceed without
   * deleting the encrypted backup (may be recoverable later).
   */
  quarantinePartition(vaultType: VaultType): Promise<boolean>;
  readBase(vaultType: VaultType): Promise<VaultBlob | null>;
  setBase(vaultType: VaultType, blob: VaultBlob): Promise<void>;
}

/**
 * Compose the namespaced storage key for a partition or base blob.
 * Keeps live partition blobs and synced-base blobs in disjoint key spaces.
 */
function storageKey(namespace: StorageNamespace, vaultType: VaultType): string {
  return `cpv:${namespace}:${vaultType}`;
}

/**
 * Validate and normalize a VaultBlob before persisting. Ensures only the four
 * envelope fields are written at rest — never any plaintext fields a caller may
 * have attached to the object (Requirements 22.4, 5.1).
 */
function normalizeBlob(blob: VaultBlob): VaultBlob {
  if (
    blob == null ||
    typeof blob !== 'object' ||
    typeof blob.iv !== 'string' ||
    typeof blob.auth_tag !== 'string' ||
    typeof blob.ciphertext !== 'string' ||
    typeof blob.sync_version !== 'number' ||
    !Number.isInteger(blob.sync_version) ||
    blob.sync_version < 0
  ) {
    throw new TypeError('invalid VaultBlob: expected { sync_version:int>=0, iv, auth_tag, ciphertext }');
  }
  return {
    sync_version: blob.sync_version,
    iv: blob.iv,
    auth_tag: blob.auth_tag,
    ciphertext: blob.ciphertext,
  };
}

/**
 * Parse a stored string back into a VaultBlob. Returns `null` for absent or
 * structurally invalid entries rather than throwing, so a corrupt single entry
 * does not crash reads.
 */
function parseBlob(raw: string | null): VaultBlob | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      typeof (parsed as VaultBlob).iv !== 'string' ||
      typeof (parsed as VaultBlob).auth_tag !== 'string' ||
      typeof (parsed as VaultBlob).ciphertext !== 'string' ||
      typeof (parsed as VaultBlob).sync_version !== 'number'
    ) {
      return null;
    }
    const blob = parsed as VaultBlob;
    return {
      sync_version: blob.sync_version,
      iv: blob.iv,
      auth_tag: blob.auth_tag,
      ciphertext: blob.ciphertext,
    };
  } catch {
    return null;
  }
}

/**
 * Concrete Local_Vault over a pluggable {@link StorageBackend}.
 */
export class EncryptedLocalVault implements LocalVault {
  private readonly backend: StorageBackend;
  private initialized = false;

  constructor(backend: StorageBackend) {
    this.backend = backend;
  }

  /**
   * Open/unlock the backing store. On failure, block access (leave
   * `initialized` false) and surface LOCAL_STORAGE_INITIALIZATION_FAILED while
   * leaving any previously persisted encrypted data untouched (Req 22.5).
   */
  async init(): Promise<void> {
    try {
      await this.backend.open();
      this.initialized = true;
    } catch (cause) {
      this.initialized = false;
      throw new LocalVaultError(
        'LOCAL_STORAGE_INITIALIZATION_FAILED',
        `local storage initialization failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  async readPartition(vaultType: VaultType): Promise<VaultBlob | null> {
    this.assertInitialized();
    const raw = await this.backend.getItem(storageKey('partition', vaultType));
    return parseBlob(raw);
  }

  /**
   * Atomically persist the partition blob. The blob is normalized to the four
   * envelope fields and serialized before being committed durably by the
   * backend; the write is readable on the next read without network access
   * (Requirements 5.4, 22.4).
   */
  async writePartition(vaultType: VaultType, blob: VaultBlob): Promise<void> {
    this.assertInitialized();
    const serialized = JSON.stringify(normalizeBlob(blob));
    await this.backend.setItem(storageKey('partition', vaultType), serialized);
  }

  async clearPartition(vaultType: VaultType): Promise<void> {
    this.assertInitialized();
    await this.backend.removeItem(storageKey('partition', vaultType));
  }

  async quarantinePartition(vaultType: VaultType): Promise<boolean> {
    this.assertInitialized();
    const partitionKey = storageKey('partition', vaultType);
    const raw = await this.backend.getItem(partitionKey);
    if (raw === null) {
      return false;
    }
    await this.backend.setItem(storageKey('quarantine', vaultType), raw);
    await this.backend.removeItem(partitionKey);
    return true;
  }

  async readBase(vaultType: VaultType): Promise<VaultBlob | null> {
    this.assertInitialized();
    const raw = await this.backend.getItem(storageKey('base', vaultType));
    return parseBlob(raw);
  }

  async setBase(vaultType: VaultType, blob: VaultBlob): Promise<void> {
    this.assertInitialized();
    const serialized = JSON.stringify(normalizeBlob(blob));
    await this.backend.setItem(storageKey('base', vaultType), serialized);
  }

  /**
   * Block every data operation until init has succeeded (Requirement 22.5).
   */
  private assertInitialized(): void {
    if (!this.initialized) {
      throw new LocalVaultError(
        'VAULT_NOT_INITIALIZED',
        'Local_Vault access is blocked until init() succeeds',
      );
    }
  }
}

/**
 * Factory: construct and initialize an {@link EncryptedLocalVault}.
 * Rejects with LOCAL_STORAGE_INITIALIZATION_FAILED if the backend cannot open.
 */
export async function createLocalVault(
  backend: StorageBackend,
): Promise<EncryptedLocalVault> {
  const vault = new EncryptedLocalVault(backend);
  await vault.init();
  return vault;
}
