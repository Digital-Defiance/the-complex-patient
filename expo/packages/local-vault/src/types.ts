/**
 * @complex-patient/local-vault — Type definitions
 *
 * Core types for the encrypted local persistence layer.
 *
 * The Local_Vault is the client-side source of truth for the UI. It persists
 * encrypted `VaultBlob` envelopes only — never plaintext PHI (Requirements 5.1,
 * 22.4). It is backed at runtime by expo-sqlite (default) or encrypted
 * react-native-mmkv via a pluggable {@link StorageBackend}.
 */

import type { VaultType } from '@complex-patient/domain';

/**
 * The encrypted envelope persisted for a single vault partition.
 *
 * This mirrors the Crypto_Engine `EncryptedPayload` plus the optimistic
 * concurrency token. Only these four fields ever cross the trust boundary
 * (Requirements 2.8, 4.6, 6.2, 6.3) and only these fields are stored at rest.
 *
 * - `sync_version`: optimistic concurrency token; initial stored version = 1 (7.4)
 * - `iv`: Base64-encoded 12-byte initialization vector (2.2)
 * - `auth_tag`: Base64-encoded 16-byte authentication tag (2.3)
 * - `ciphertext`: Base64-encoded AES-256-GCM ciphertext of the partition JSON (2.8)
 */
export interface VaultBlob {
  sync_version: number;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

/**
 * Error codes surfaced by the Local_Vault.
 *
 * `LOCAL_STORAGE_INITIALIZATION_FAILED` is raised when init/unlock of the
 * backing store fails. In that state the vault blocks all access and leaves
 * previously persisted encrypted data unchanged (Requirements 22.5, 5.4).
 */
export type LocalVaultErrorCode =
  | 'LOCAL_STORAGE_INITIALIZATION_FAILED'
  | 'VAULT_NOT_INITIALIZED';

/**
 * Typed error thrown by the Local_Vault.
 */
export class LocalVaultError extends Error {
  readonly code: LocalVaultErrorCode;

  constructor(code: LocalVaultErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LocalVaultError';
    this.code = code;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, LocalVaultError.prototype);
  }
}

/**
 * The storage key namespace separating live partition blobs from the
 * last-common-synced base blobs used by the three-way merge (Requirement 8.5).
 */
export type StorageNamespace = 'partition' | 'base' | 'quarantine';

/**
 * Low-level encrypted key/value store abstraction.
 *
 * Concrete implementations wrap expo-sqlite (default) or encrypted
 * react-native-mmkv. Implementations store and return opaque strings only and
 * never interpret their contents; the Local_Vault writes Base64/JSON-serialized
 * {@link VaultBlob} ciphertext envelopes through this interface so that nothing
 * but ciphertext is ever handed to the backend (Requirements 22.4, 5.1).
 *
 * All methods may reject; the Local_Vault translates initialization rejections
 * into a `LOCAL_STORAGE_INITIALIZATION_FAILED` error (Requirement 22.5).
 */
export interface StorageBackend {
  /**
   * Open/unlock the underlying store. Rejecting here causes the Local_Vault to
   * block access and leave any persisted data unchanged (Requirement 22.5).
   */
  open(): Promise<void>;

  /** Read the raw stored string for a key, or `null` if absent. */
  getItem(key: string): Promise<string | null>;

  /** Atomically persist the raw string for a key. Implementations MUST commit
   * durably before resolving so the write is readable on the next read without
   * a network round-trip (Requirement 5.4).
   */
  setItem(key: string, value: string): Promise<void>;

  /** Remove a persisted key. Used when clearing an undecryptable partition. */
  removeItem(key: string): Promise<void>;
}
