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
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CryptoKeyRef, EncryptedPayload, DecryptResult } from './types';

/** IV length in bytes (96-bit nonce for AES-GCM). */
const IV_BYTE_LENGTH = 12;

/** Authentication tag length in bytes (128-bit). */
const AUTH_TAG_BYTE_LENGTH = 16;

/** AES-256-GCM algorithm identifier for node:crypto. */
const ALGORITHM = 'aes-256-gcm' as const;

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

  // Generate fresh random 12-byte IV (Requirement 2.2)
  const iv = randomBytes(IV_BYTE_LENGTH);

  // Create cipher with AES-256-GCM (Requirement 2.1)
  const cipher = createCipheriv(ALGORITHM, keyBytes, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });

  // Encrypt the plaintext
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  // Retrieve the 16-byte authentication tag (Requirement 2.3)
  const authTag = cipher.getAuthTag();

  // Return all fields as Base64 strings (Requirement 2.8)
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
  // Reject malformed blobs BEFORE any decryption attempt.
  // -------------------------------------------------------------------------
  const validation = validateBlob(blob);
  if (!validation.ok) {
    return { ok: false, error: 'MALFORMED_BLOB' };
  }

  const { iv, authTag, ciphertext } = validation;

  // -------------------------------------------------------------------------
  // Step 2: Attempt decryption with tag verification (Requirements 2.4–2.6)
  // -------------------------------------------------------------------------
  const keyBytes = kek._inner as Uint8Array;

  try {
    const decipher = createDecipheriv(ALGORITHM, keyBytes, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });

    // Set the authentication tag for verification (Requirement 2.4)
    decipher.setAuthTag(authTag);

    // Decrypt — node:crypto verifies the tag during final()
    // If tag verification fails, final() throws (Requirement 2.4)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Tag verified successfully — return plaintext (Requirement 2.5)
    return {
      ok: true,
      plaintext: new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength),
    };
  } catch {
    // Tag verification failed — NEVER return partial plaintext (Requirement 2.6)
    return { ok: false, error: 'AUTH_TAG_FAILED' };
  }
}

// ---------------------------------------------------------------------------
// Internal: Blob validation
// ---------------------------------------------------------------------------

interface ValidatedBlob {
  ok: true;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

interface InvalidBlob {
  ok: false;
}

/**
 * Validate the structure of an EncryptedPayload before attempting decryption.
 * Checks:
 * - All fields are present and are strings
 * - All fields are valid Base64
 * - IV decodes to exactly 12 bytes
 * - authTag decodes to exactly 16 bytes
 * - ciphertext decodes to at least 1 byte
 */
function validateBlob(blob: EncryptedPayload): ValidatedBlob | InvalidBlob {
  // Check presence and type of all required fields
  if (
    blob == null ||
    typeof blob !== 'object' ||
    typeof blob.iv !== 'string' ||
    typeof blob.authTag !== 'string' ||
    typeof blob.ciphertext !== 'string'
  ) {
    return { ok: false };
  }

  // Decode and validate IV (must be exactly 12 bytes)
  const iv = safeBase64Decode(blob.iv);
  if (iv === null || iv.length !== IV_BYTE_LENGTH) {
    return { ok: false };
  }

  // Decode and validate authTag (must be exactly 16 bytes)
  const authTag = safeBase64Decode(blob.authTag);
  if (authTag === null || authTag.length !== AUTH_TAG_BYTE_LENGTH) {
    return { ok: false };
  }

  // Decode and validate ciphertext (must be non-empty)
  const ciphertext = safeBase64Decode(blob.ciphertext);
  if (ciphertext === null || ciphertext.length === 0) {
    return { ok: false };
  }

  return { ok: true, iv, authTag, ciphertext };
}

/**
 * Safely decode a Base64 string. Returns null if the input is not valid Base64.
 */
function safeBase64Decode(input: string): Buffer | null {
  try {
    // Reject empty strings
    if (input.length === 0) {
      return null;
    }

    const decoded = Buffer.from(input, 'base64');

    // Verify the string was actually valid Base64 by re-encoding and comparing.
    // Buffer.from tolerates non-base64 chars by ignoring them, so we must check
    // that the round-trip is lossless.
    if (decoded.toString('base64') !== input) {
      // Allow for base64 variants without padding by checking both
      const withoutPadding = decoded.toString('base64').replace(/=+$/, '');
      const inputWithoutPadding = input.replace(/=+$/, '');
      if (withoutPadding !== inputWithoutPadding) {
        return null;
      }
    }

    return decoded;
  } catch {
    return null;
  }
}
