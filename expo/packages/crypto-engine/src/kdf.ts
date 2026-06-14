/**
 * @complex-patient/crypto-engine — Key Derivation Functions
 *
 * Implements salt generation and KEK derivation.
 * All operations execute strictly on the client — the passphrase and KEK
 * are never transmitted over the network (Requirements 1.3, 1.4).
 */

import { pbkdf2, randomBytes } from 'node:crypto';
import type { KdfParams, DeriveResult } from './types';
import { wrapKey } from './types';

/** Minimum passphrase length per Requirement 1.9. */
const MIN_PASSPHRASE_LENGTH = 12;

/** Default PBKDF2 iteration count per Requirement 1.2 (≥600,000). */
const DEFAULT_PBKDF2_ITERATIONS = 600_000;

/** Minimum Argon2id memory cost in KiB (64 MiB = 65,536 KiB) per Requirement 1.2. */
const MIN_ARGON_MEMORY_KIB = 65_536;

/** Derived key length in bytes (256 bits). */
const KEK_BYTE_LENGTH = 32;

/** Salt length in bytes (≥16 per Requirement 1.1). */
const SALT_BYTE_LENGTH = 16;

/**
 * Generate a cryptographically secure random salt of at least 16 bytes.
 * Uses CSPRNG via globalThis.crypto.getRandomValues when available,
 * falling back to node:crypto.randomBytes for Node.js environments.
 *
 * Requirement 1.1: unique per vault, ≥16 bytes from CSPRNG.
 */
export async function generateSalt(): Promise<Uint8Array> {
  // Prefer Web Crypto getRandomValues if available (works in browsers and modern Node)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const salt = new Uint8Array(SALT_BYTE_LENGTH);
    globalThis.crypto.getRandomValues(salt);
    return salt;
  }

  // Fallback: node:crypto.randomBytes
  const buf = randomBytes(SALT_BYTE_LENGTH);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Derive a 256-bit KEK from the Master_Passphrase and vault salt.
 *
 * Requirements:
 * - 1.2: PBKDF2 ≥600,000 iterations or Argon2id ≥64 MiB memory
 * - 1.3: All derivation strictly client-side
 * - 1.4: Passphrase/KEK never transmitted
 * - 1.9: Reject passphrases < 12 chars (PASSPHRASE_TOO_SHORT)
 * - 1.10: On failure, zero partial key material and return DERIVATION_FAILED
 *
 * @param passphrase — The user's Master_Passphrase (never transmitted)
 * @param salt — The vault-specific salt from generateSalt()
 * @param params — KDF algorithm parameters (stored alongside salt, not secret)
 */
export async function deriveKEK(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<DeriveResult> {
  // Requirement 1.9: reject short passphrases BEFORE any derivation
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return { ok: false, error: 'PASSPHRASE_TOO_SHORT' };
  }

  // Allocate buffer for derived key material
  let keyMaterial: Uint8Array | null = null;

  try {
    if (params.algorithm === 'PBKDF2') {
      keyMaterial = await derivePBKDF2(passphrase, salt, params);
    } else if (params.algorithm === 'Argon2id') {
      keyMaterial = await deriveArgon2id(passphrase, salt, params);
    } else {
      // Unknown algorithm — treat as derivation failure
      return { ok: false, error: 'DERIVATION_FAILED' };
    }

    if (!keyMaterial || keyMaterial.length !== KEK_BYTE_LENGTH) {
      return { ok: false, error: 'DERIVATION_FAILED' };
    }

    // Wrap into opaque CryptoKeyRef (prevents accidental logging/serialization)
    const kek = wrapKey(keyMaterial);

    // Clear the local reference — the underlying bytes are now owned by the CryptoKeyRef
    keyMaterial = null;

    return { ok: true, kek };
  } catch {
    // Requirement 1.10: zero partial key material on failure
    if (keyMaterial) {
      zeroOut(keyMaterial);
      keyMaterial = null;
    }
    return { ok: false, error: 'DERIVATION_FAILED' };
  }
}

// ---------------------------------------------------------------------------
// Internal: PBKDF2 derivation (node:crypto)
// ---------------------------------------------------------------------------

function derivePBKDF2(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  const iterations = params.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS;

  // Requirement 1.2: reject iteration counts below the minimum (600,000)
  if (iterations < DEFAULT_PBKDF2_ITERATIONS) {
    return Promise.reject(new Error(`PBKDF2 iterations ${iterations} below minimum ${DEFAULT_PBKDF2_ITERATIONS}`));
  }

  return new Promise((resolve, reject) => {
    pbkdf2(
      passphrase,
      salt,
      iterations,
      KEK_BYTE_LENGTH,
      'sha256',
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(new Uint8Array(derivedKey.buffer, derivedKey.byteOffset, derivedKey.byteLength));
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Internal: Argon2id derivation (optional native binding)
// ---------------------------------------------------------------------------

/**
 * Argon2id derivation path. Since Argon2id requires a native binding (e.g., argon2),
 * this returns DERIVATION_FAILED if no binding is available.
 * The native binding will be integrated when the provider abstraction is added.
 */
async function deriveArgon2id(
  _passphrase: string,
  _salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  // Enforce minimum memory cost
  const memoryKiB = params.argonMemoryKiB ?? MIN_ARGON_MEMORY_KIB;
  if (memoryKiB < MIN_ARGON_MEMORY_KIB) {
    throw new Error('Argon2id memory cost below minimum 64 MiB (65,536 KiB)');
  }

  // No native Argon2id binding available yet — fail gracefully
  // This will be implemented when the native provider is integrated
  throw new Error('Argon2id binding not available in current environment');
}

// ---------------------------------------------------------------------------
// Internal: zero out memory
// ---------------------------------------------------------------------------

/**
 * Zero out a Uint8Array to clear sensitive key material from memory.
 * Requirement 1.10: partial key material cleared on failure.
 */
function zeroOut(buffer: Uint8Array): void {
  buffer.fill(0);
}
