/**
 * @complex-patient/crypto-engine — AES-256-GCM Encryption & Decryption
 *
 * Implements symmetric encryption/decryption using AES-256-GCM.
 * All operations execute strictly on the client (Requirements 2.1–2.8).
 *
 * Security guarantees:
 * - Fresh random 12-byte IV per encryption call (Requirement 2.2)
 * - 16-byte authentication tag (Requirement 2.3)
 * - Tag verified BEFORE returning any plaintext (Requirement 2.4)
 * - No partial plaintext ever returned on failure (Requirements 2.5, 2.6)
 * - Malformed blobs rejected before decryption attempt (Requirement 2.7)
 * - All output fields Base64-encoded (Requirement 2.8)
 *
 * Uses Web Crypto API (SubtleCrypto) when available (browser/RN), falling back
 * to node:crypto for Node.js environments (vitest).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CryptoKeyRef, EncryptedPayload, DecryptResult } from './types';

/** IV length in bytes (96-bit nonce for AES-GCM). */
const IV_BYTE_LENGTH = 12;

/** Authentication tag length in bytes (128-bit). */
const AUTH_TAG_BYTE_LENGTH = 16;

/** AES-256-GCM algorithm identifier for node:crypto. */
const ALGORITHM = 'aes-256-gcm' as const;

// ---------------------------------------------------------------------------
// Environment detection: prefer SubtleCrypto for real AES-GCM in browsers/RN.
// node:crypto works natively in Node.js but in bundled web/RN builds we get a
// shim that cannot implement sync createCipheriv properly. SubtleCrypto can.
// ---------------------------------------------------------------------------

/** True when we have real SubtleCrypto with encrypt/decrypt support. */
function hasSubtleCrypto(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.encrypt === 'function' &&
    typeof globalThis.crypto.subtle.decrypt === 'function'
  );
}

/** Generate a random IV using the best available CSPRNG. */
function generateIV(): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const iv = new Uint8Array(IV_BYTE_LENGTH);
    globalThis.crypto.getRandomValues(iv);
    return iv;
  }
  const buf = randomBytes(IV_BYTE_LENGTH);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---------------------------------------------------------------------------
// Base64 helpers (isomorphic — no Buffer dependency for web path)
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser fallback
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(str, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  // Browser fallback
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// SubtleCrypto-based encrypt/decrypt (used in browser/RN environments)
// ---------------------------------------------------------------------------

async function encryptSubtle(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
  iv: Uint8Array,
): Promise<{ ciphertext: Uint8Array; authTag: Uint8Array }> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );

  // SubtleCrypto AES-GCM appends the auth tag to the ciphertext
  const combined = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_BYTE_LENGTH * 8 },
    cryptoKey,
    plaintext,
  );

  const combinedBytes = new Uint8Array(combined);
  // Last 16 bytes are the auth tag
  const ciphertext = combinedBytes.slice(0, combinedBytes.length - AUTH_TAG_BYTE_LENGTH);
  const authTag = combinedBytes.slice(combinedBytes.length - AUTH_TAG_BYTE_LENGTH);

  return { ciphertext, authTag };
}

async function decryptSubtle(
  ciphertext: Uint8Array,
  authTag: Uint8Array,
  keyBytes: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  // SubtleCrypto expects ciphertext + authTag concatenated
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_BYTE_LENGTH * 8 },
    cryptoKey,
    combined,
  );

  return new Uint8Array(decrypted);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext using AES-256-GCM with the provided KEK.
 *
 * Requirements:
 * - 2.1: AES-256-GCM encryption
 * - 2.2: Fresh random 12-byte IV per call
 * - 2.3: 16-byte authentication tag
 * - 2.8: Output as Base64 strings
 *
 * @param plaintext — The data to encrypt
 * @param kek — The Key Encryption Key (256-bit) wrapped in CryptoKeyRef
 * @returns EncryptedPayload with Base64-encoded iv, authTag, and ciphertext
 */
export async function encrypt(
  plaintext: Uint8Array,
  kek: CryptoKeyRef,
): Promise<EncryptedPayload> {
  const keyBytes = kek._inner as Uint8Array;
  const iv = generateIV();

  if (hasSubtleCrypto()) {
    // Web / React Native path: use SubtleCrypto for real AES-256-GCM
    const { ciphertext, authTag } = await encryptSubtle(plaintext, keyBytes, iv);
    return {
      iv: toBase64(iv),
      authTag: toBase64(authTag),
      ciphertext: toBase64(ciphertext),
    };
  }

  // Node.js path: use node:crypto (vitest, SSR)
  const cipher = createCipheriv(ALGORITHM, keyBytes, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: Buffer.from(iv).toString('base64'),
    authTag: Buffer.from(authTag).toString('base64'),
    ciphertext: Buffer.from(encrypted).toString('base64'),
  };
}

/**
 * Decrypt an EncryptedPayload using AES-256-GCM with the provided KEK.
 *
 * Requirements:
 * - 2.4: Verify auth tag BEFORE returning any plaintext
 * - 2.5: On success return { ok: true, plaintext }
 * - 2.6: On tag failure return AUTH_TAG_FAILED, NEVER return partial plaintext
 * - 2.7: Reject malformed blobs with MALFORMED_BLOB before attempting decryption
 *
 * @param blob — The encrypted payload (Base64 fields)
 * @param kek — The Key Encryption Key (256-bit) wrapped in CryptoKeyRef
 * @returns DecryptResult — success with plaintext, or typed error
 */
export async function decrypt(
  blob: EncryptedPayload,
  kek: CryptoKeyRef,
): Promise<DecryptResult> {
  // -------------------------------------------------------------------------
  // Step 1: Validate blob structure (Requirement 2.7)
  // -------------------------------------------------------------------------
  if (
    blob == null ||
    typeof blob !== 'object' ||
    typeof blob.iv !== 'string' ||
    typeof blob.authTag !== 'string' ||
    typeof blob.ciphertext !== 'string'
  ) {
    return { ok: false, error: 'MALFORMED_BLOB' };
  }

  let iv: Uint8Array;
  let authTag: Uint8Array;
  let ciphertext: Uint8Array;

  try {
    iv = fromBase64(blob.iv);
    authTag = fromBase64(blob.authTag);
    ciphertext = fromBase64(blob.ciphertext);
  } catch {
    return { ok: false, error: 'MALFORMED_BLOB' };
  }

  if (iv.length !== IV_BYTE_LENGTH) return { ok: false, error: 'MALFORMED_BLOB' };
  if (authTag.length !== AUTH_TAG_BYTE_LENGTH) return { ok: false, error: 'MALFORMED_BLOB' };
  if (ciphertext.length === 0) return { ok: false, error: 'MALFORMED_BLOB' };

  // -------------------------------------------------------------------------
  // Step 2: Attempt decryption with tag verification (Requirements 2.4–2.6)
  // -------------------------------------------------------------------------
  const keyBytes = kek._inner as Uint8Array;

  if (hasSubtleCrypto()) {
    // Web / React Native path
    try {
      const plaintext = await decryptSubtle(ciphertext, authTag, keyBytes, iv);
      return { ok: true, plaintext };
    } catch {
      return { ok: false, error: 'AUTH_TAG_FAILED' };
    }
  }

  // Node.js path
  try {
    const decipher = createDecipheriv(ALGORITHM, keyBytes, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return {
      ok: true,
      plaintext: new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength),
    };
  } catch {
    return { ok: false, error: 'AUTH_TAG_FAILED' };
  }
}
