/**
 * @complex-patient/crypto-engine — Type definitions
 *
 * Core types for the isomorphic cryptographic engine.
 * All cryptographic operations execute strictly on the client.
 */

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

/** Available cryptographic backend providers. */
export type CryptoProvider = 'web-subtle' | 'expo-crypto';

/**
 * Describes the runtime environment for provider selection.
 * Distinguishes *runtime* (native vs browser), not *device*.
 */
export interface RuntimeContext {
  /** True when running in a web browser (React Native Web). */
  isWeb: boolean;
  /** window.isSecureContext on web; irrelevant for native. */
  isSecureContext: boolean;
  /** window.crypto?.subtle is present and usable. */
  hasSubtle: boolean;
}

/**
 * Result of runtime provider selection.
 * Either a usable provider or a refusal code.
 */
export type ProviderDecision =
  | { provider: CryptoProvider; refuse?: never }
  | { refuse: 'SECURE_CONTEXT_REQUIRED'; provider?: never };

// ---------------------------------------------------------------------------
// Key material wrapper
// ---------------------------------------------------------------------------

/**
 * Opaque wrapper around key material.
 * Prevents accidental logging or serialization of raw key bytes.
 *
 * The `_inner` field holds either a Web CryptoKey object or raw Uint8Array bytes
 * depending on the selected provider. We use `unknown` for the opaque inner type
 * to avoid a hard dependency on DOM lib types — the provider implementations
 * narrow the type at usage sites.
 */
declare const __brand: unique symbol;

export interface CryptoKeyRef {
  readonly [__brand]: 'CryptoKeyRef';
  /** The underlying key — may be a Web CryptoKey or raw bytes (provider-dependent). */
  readonly _inner: unknown;
}

/**
 * Wrap raw key material into a branded CryptoKeyRef.
 * This function is the only sanctioned way to create a CryptoKeyRef.
 */
export function wrapKey(inner: unknown): CryptoKeyRef {
  return { _inner: inner } as unknown as CryptoKeyRef;
}

// ---------------------------------------------------------------------------
// KDF parameters
// ---------------------------------------------------------------------------

/** Parameters governing key derivation. Stored alongside the salt (not secret). */
export interface KdfParams {
  algorithm: 'PBKDF2' | 'Argon2id';
  /** PBKDF2 iteration count (≥ 600,000 per Requirement 1.2). */
  pbkdf2Iterations?: number;
  /** Argon2id memory cost in KiB (≥ 65,536 = 64 MiB per Requirement 1.2). */
  argonMemoryKiB?: number;
  /** Argon2id time cost (iterations). */
  argonIterations?: number;
}

// ---------------------------------------------------------------------------
// Encrypted payload (on-wire / at-rest structure)
// ---------------------------------------------------------------------------

/**
 * The encrypted payload produced by AES-256-GCM encryption.
 * All fields are Base64-encoded strings.
 */
export interface EncryptedPayload {
  /** Base64-encoded 12-byte initialization vector (Requirement 2.2). */
  iv: string;
  /** Base64-encoded 16-byte authentication tag (Requirement 2.3). */
  authTag: string;
  /** Base64-encoded ciphertext (Requirement 2.8). */
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result of key derivation. */
export type DeriveResult =
  | { ok: true; kek: CryptoKeyRef }
  | { ok: false; error: 'PASSPHRASE_TOO_SHORT' | 'DERIVATION_FAILED' | 'SECURE_CONTEXT_REQUIRED' };

/** Result of decryption. */
export type DecryptResult =
  | { ok: true; plaintext: Uint8Array }
  | { ok: false; error: 'AUTH_TAG_FAILED' | 'MALFORMED_BLOB' };

// ---------------------------------------------------------------------------
// CryptoEngine interface
// ---------------------------------------------------------------------------

/**
 * The isomorphic CryptoEngine interface.
 * Every target (iOS, Android, Web) invokes crypto exclusively through this interface.
 * Requirement 22.3: single source of all cryptographic primitives.
 */
export interface CryptoEngine {
  /** Generate a 16-byte CSPRNG salt, unique per vault (Requirement 1.1). */
  generateSalt(): Promise<Uint8Array>;

  /**
   * Derive a 256-bit KEK from the passphrase and salt (Requirements 1.2, 1.9, 1.10).
   * Rejects passphrases < 12 chars with PASSPHRASE_TOO_SHORT.
   * On failure, zeroes partial key material and returns DERIVATION_FAILED.
   */
  deriveKEK(passphrase: string, salt: Uint8Array, params: KdfParams): Promise<DeriveResult>;

  /**
   * Encrypt plaintext with AES-256-GCM (Requirements 2.1–2.3, 2.8).
   * Generates a fresh 12-byte IV per call.
   */
  encrypt(plaintext: Uint8Array, kek: CryptoKeyRef): Promise<EncryptedPayload>;

  /**
   * Decrypt an EncryptedPayload, verifying the auth tag first (Requirements 2.4–2.7).
   * Returns AUTH_TAG_FAILED or MALFORMED_BLOB on failure — never partial plaintext.
   */
  decrypt(blob: EncryptedPayload, kek: CryptoKeyRef): Promise<DecryptResult>;
}
