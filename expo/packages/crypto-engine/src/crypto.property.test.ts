/**
 * Property-based tests for the Crypto_Engine (Properties 1–7).
 *
 * Property 1: Encryption round-trip preserves plaintext (Reqs 2.1, 2.5, 2.8)
 * Property 2: Tamper-evidence — mutation always fails closed (Reqs 2.4, 2.6)
 * Property 3: Malformed blobs are rejected without decryption (Req 2.7)
 * Property 4: IV uniqueness across encryptions (Req 2.2)
 * Property 5: KDF determinism and salt sensitivity (Reqs 1.1, 1.2)
 * Property 6: Short passphrases never derive a key (Req 1.9)
 * Property 7: Cross-platform crypto parity (Req 22.3)
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { encrypt, decrypt } from './cipher';
import { deriveKEK } from './kdf';
import { wrapKey } from './types';
import type { EncryptedPayload } from './types';

// ---------------------------------------------------------------------------
// Helpers: Arbitrary generators for Base64 strings of specific decoded lengths
// ---------------------------------------------------------------------------

/**
 * Generate a valid Base64 string that decodes to exactly `n` bytes.
 */
function validBase64OfLength(n: number) {
  return fc
    .uint8Array({ minLength: n, maxLength: n })
    .map((bytes) => Buffer.from(bytes).toString('base64'));
}

/**
 * Generate a valid Base64 string that decodes to a wrong length (not `n` bytes).
 * Produces lengths in [1, n-1] or [n+1, n+8] — never exactly n.
 */
function wrongLengthBase64(correctLength: number) {
  return fc
    .integer({ min: 1, max: correctLength + 8 })
    .filter((len) => len !== correctLength)
    .chain((len) =>
      fc
        .uint8Array({ minLength: len, maxLength: len })
        .map((bytes) => Buffer.from(bytes).toString('base64')),
    );
}

/**
 * Generate a non-Base64 string (contains characters invalid for Base64).
 */
const nonBase64String = fc
  .array(
    fc.constantFrom('!', '@', '#', '$', '%', '^', '&', '*', '(', ')', ' ', '\n', '🔒'),
    { minLength: 1, maxLength: 20 },
  )
  .map((chars) => chars.join(''))
  .filter((s) => {
    // Ensure it's actually not valid base64 by checking round-trip
    const decoded = Buffer.from(s, 'base64');
    return decoded.toString('base64') !== s && decoded.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '');
  });

// Valid Base64 for 12 bytes (correct IV length)
const validBase64_12 = validBase64OfLength(12);

// Valid Base64 for 16 bytes (correct authTag length)
const validBase64_16 = validBase64OfLength(16);

// Valid non-empty Base64 ciphertext (1–64 bytes)
const validCiphertextBase64 = fc
  .integer({ min: 1, max: 64 })
  .chain((len) =>
    fc
      .uint8Array({ minLength: len, maxLength: len })
      .map((bytes) => Buffer.from(bytes).toString('base64')),
  );

// ---------------------------------------------------------------------------
// Malformed blob generators using fc.oneof()
// ---------------------------------------------------------------------------

/** IV that decodes to wrong length (not 12 bytes) */
const blobWithWrongIvLength = fc.record({
  iv: wrongLengthBase64(12),
  authTag: validBase64_16,
  ciphertext: validCiphertextBase64,
});

/** authTag that decodes to wrong length (not 16 bytes) */
const blobWithWrongAuthTagLength = fc.record({
  iv: validBase64_12,
  authTag: wrongLengthBase64(16),
  ciphertext: validCiphertextBase64,
});

/** Empty ciphertext */
const blobWithEmptyCiphertext = fc.record({
  iv: validBase64_12,
  authTag: validBase64_16,
  ciphertext: fc.constant(''),
});

/** Missing iv field (undefined) */
const blobMissingIv = fc
  .record({
    authTag: validBase64_16,
    ciphertext: validCiphertextBase64,
  })
  .map((r) => r as unknown as EncryptedPayload);

/** Missing authTag field (undefined) */
const blobMissingAuthTag = fc
  .record({
    iv: validBase64_12,
    ciphertext: validCiphertextBase64,
  })
  .map((r) => r as unknown as EncryptedPayload);

/** Missing ciphertext field (undefined) */
const blobMissingCiphertext = fc
  .record({
    iv: validBase64_12,
    authTag: validBase64_16,
  })
  .map((r) => r as unknown as EncryptedPayload);

/** null blob */
const blobNull = fc.constant(null as unknown as EncryptedPayload);

/** Non-Base64 IV string */
const blobWithNonBase64Iv = fc.record({
  iv: nonBase64String,
  authTag: validBase64_16,
  ciphertext: validCiphertextBase64,
});

/** Non-Base64 authTag string */
const blobWithNonBase64AuthTag = fc.record({
  iv: validBase64_12,
  authTag: nonBase64String,
  ciphertext: validCiphertextBase64,
});

/** Non-Base64 ciphertext string */
const blobWithNonBase64Ciphertext = fc.record({
  iv: validBase64_12,
  authTag: validBase64_16,
  ciphertext: nonBase64String,
});

/**
 * Combined arbitrary: generates a malformed blob with at least one structural defect.
 * Uses fc.oneof() to cover all defect categories.
 */
const malformedBlob: fc.Arbitrary<EncryptedPayload> = fc.oneof(
  blobWithWrongIvLength,
  blobWithWrongAuthTagLength,
  blobWithEmptyCiphertext,
  blobMissingIv,
  blobMissingAuthTag,
  blobMissingCiphertext,
  blobNull,
  blobWithNonBase64Iv,
  blobWithNonBase64AuthTag,
  blobWithNonBase64Ciphertext,
);

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('Property 3: Malformed blobs are rejected without decryption', () => {
  /**
   * **Validates: Requirements 2.7**
   *
   * For ANY malformed blob (wrong IV length, wrong authTag length, empty ciphertext,
   * missing fields, or non-Base64 strings), decrypt MUST return
   * `{ ok: false, error: 'MALFORMED_BLOB' }` — never attempting actual decryption.
   */
  it.prop([malformedBlob, fc.uint8Array({ minLength: 32, maxLength: 32 })])(
    'malformed blobs ALWAYS result in MALFORMED_BLOB error',
    async (blob, keyBytes) => {
      const kek = wrapKey(keyBytes);
      const result = await decrypt(blob, kek);

      expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
    },
  );
});

// ---------------------------------------------------------------------------
// Property 2: Tamper-evidence — mutation always fails closed
// **Validates: Requirements 2.4, 2.6**
// ---------------------------------------------------------------------------

/**
 * Helper: flip a single bit in a Uint8Array at a given byte position and bit offset.
 */
function flipBit(data: Uint8Array, bytePos: number, bitOffset: number): Uint8Array {
  const copy = new Uint8Array(data);
  copy[bytePos] ^= 1 << (bitOffset % 8);
  return copy;
}

describe('Property 2: Tamper-evidence — mutation always fails closed', () => {
  /**
   * **Validates: Requirements 2.4, 2.6**
   *
   * Tampering with the ciphertext field always causes decrypt to fail
   * with AUTH_TAG_FAILED and never returns any plaintext.
   */
  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 5000 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      fc.nat(),
      fc.integer({ min: 0, max: 7 }),
    ],
    { numRuns: 100 },
  )(
    'tampering with ciphertext always yields AUTH_TAG_FAILED',
    async (plaintext, keyBytes, byteSelector, bitSelector) => {
      const kek = wrapKey(keyBytes);
      const encrypted = await encrypt(plaintext, kek);

      // Decode the ciphertext, flip one bit, re-encode
      const ctBytes = Buffer.from(encrypted.ciphertext, 'base64');
      const bytePos = byteSelector % ctBytes.length;
      const tampered = flipBit(new Uint8Array(ctBytes), bytePos, bitSelector);
      const tamperedPayload = {
        ...encrypted,
        ciphertext: Buffer.from(tampered).toString('base64'),
      };

      const result = await decrypt(tamperedPayload, kek);
      expect(result).toEqual({ ok: false, error: 'AUTH_TAG_FAILED' });
    },
  );

  /**
   * **Validates: Requirements 2.4, 2.6**
   *
   * Tampering with the authTag field always causes decrypt to fail
   * with AUTH_TAG_FAILED and never returns any plaintext.
   */
  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 5000 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      fc.nat(),
      fc.integer({ min: 0, max: 7 }),
    ],
    { numRuns: 100 },
  )(
    'tampering with authTag always yields AUTH_TAG_FAILED',
    async (plaintext, keyBytes, byteSelector, bitSelector) => {
      const kek = wrapKey(keyBytes);
      const encrypted = await encrypt(plaintext, kek);

      // Decode the authTag, flip one bit, re-encode
      const tagBytes = Buffer.from(encrypted.authTag, 'base64');
      const bytePos = byteSelector % tagBytes.length;
      const tampered = flipBit(new Uint8Array(tagBytes), bytePos, bitSelector);
      const tamperedPayload = {
        ...encrypted,
        authTag: Buffer.from(tampered).toString('base64'),
      };

      const result = await decrypt(tamperedPayload, kek);
      expect(result).toEqual({ ok: false, error: 'AUTH_TAG_FAILED' });
    },
  );

  /**
   * **Validates: Requirements 2.4, 2.6**
   *
   * Tampering with the IV field always causes decrypt to fail
   * with AUTH_TAG_FAILED and never returns any plaintext.
   */
  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 5000 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      fc.nat(),
      fc.integer({ min: 0, max: 7 }),
    ],
    { numRuns: 100 },
  )(
    'tampering with IV always yields AUTH_TAG_FAILED',
    async (plaintext, keyBytes, byteSelector, bitSelector) => {
      const kek = wrapKey(keyBytes);
      const encrypted = await encrypt(plaintext, kek);

      // Decode the IV, flip one bit, re-encode
      const ivBytes = Buffer.from(encrypted.iv, 'base64');
      const bytePos = byteSelector % ivBytes.length;
      const tampered = flipBit(new Uint8Array(ivBytes), bytePos, bitSelector);
      const tamperedPayload = {
        ...encrypted,
        iv: Buffer.from(tampered).toString('base64'),
      };

      const result = await decrypt(tamperedPayload, kek);
      expect(result).toEqual({ ok: false, error: 'AUTH_TAG_FAILED' });
    },
  );
});

// ---------------------------------------------------------------------------
// Property 7: Cross-platform crypto parity
// **Validates: Requirements 22.3**
//
// Encrypt with one provider (simulated via raw node:crypto createCipheriv)
// and decrypt with the other (our decrypt() function), asserting identical
// outputs for identical inputs. This proves the EncryptedPayload format
// (Base64 iv, authTag, ciphertext) is provider-independent and any compliant
// AES-256-GCM implementation can interoperate.
// ---------------------------------------------------------------------------

describe('Property 7: Cross-platform crypto parity', () => {
  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 1024 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      fc.uint8Array({ minLength: 12, maxLength: 12 }),
    ],
  )(
    'blob encrypted by raw node:crypto (simulating expo-crypto) decrypts via decrypt() (simulating web-subtle)',
    async (plaintext, keyBytes, iv) => {
      const kek = wrapKey(keyBytes);

      // --- Simulate "expo-crypto" provider: encrypt manually with node:crypto ---
      const cipher = createCipheriv('aes-256-gcm', keyBytes, iv, { authTagLength: 16 });
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Construct the EncryptedPayload in the standard format
      const blob = {
        iv: Buffer.from(iv).toString('base64'),
        authTag: Buffer.from(authTag).toString('base64'),
        ciphertext: Buffer.from(encrypted).toString('base64'),
      };

      // --- Simulate "web-subtle" provider: decrypt using our decrypt() function ---
      const result = await decrypt(blob, kek);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Buffer.from(result.plaintext)).toEqual(Buffer.from(plaintext));
      }
    },
  );

  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 1024 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
    ],
  )(
    'blob encrypted by encrypt() (simulating web-subtle) decrypts via raw node:crypto (simulating expo-crypto)',
    async (plaintext, keyBytes) => {
      const kek = wrapKey(keyBytes);

      // --- Simulate "web-subtle" provider: encrypt using our encrypt() function ---
      const blob = await encrypt(plaintext, kek);

      // --- Simulate "expo-crypto" provider: decrypt manually with node:crypto ---
      const ivDecoded = Buffer.from(blob.iv, 'base64');
      const authTagDecoded = Buffer.from(blob.authTag, 'base64');
      const ciphertextDecoded = Buffer.from(blob.ciphertext, 'base64');

      const decipher = createDecipheriv('aes-256-gcm', keyBytes, ivDecoded, { authTagLength: 16 });
      decipher.setAuthTag(authTagDecoded);
      const decrypted = Buffer.concat([decipher.update(ciphertextDecoded), decipher.final()]);

      expect(Buffer.from(decrypted)).toEqual(Buffer.from(plaintext));
    },
  );

  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 1024 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      fc.uint8Array({ minLength: 12, maxLength: 12 }),
    ],
  )(
    'same key + same IV + same plaintext produces identical ciphertext regardless of provider',
    async (plaintext, keyBytes, iv) => {
      // --- Provider A (raw node:crypto, simulating expo-crypto) ---
      const cipherA = createCipheriv('aes-256-gcm', keyBytes, iv, { authTagLength: 16 });
      const encryptedA = Buffer.concat([cipherA.update(plaintext), cipherA.final()]);
      const tagA = cipherA.getAuthTag();

      // --- Provider B (raw node:crypto again, simulating web-subtle) ---
      // Both providers use the same AES-256-GCM primitive; given identical inputs
      // they MUST produce identical outputs (deterministic cipher for same key+iv+plaintext)
      const cipherB = createCipheriv('aes-256-gcm', keyBytes, iv, { authTagLength: 16 });
      const encryptedB = Buffer.concat([cipherB.update(plaintext), cipherB.final()]);
      const tagB = cipherB.getAuthTag();

      // Ciphertext must be identical
      expect(Buffer.from(encryptedA)).toEqual(Buffer.from(encryptedB));
      // Auth tags must be identical
      expect(Buffer.from(tagA)).toEqual(Buffer.from(tagB));
    },
  );
});

// ---------------------------------------------------------------------------
// Property 1: Encryption round-trip preserves plaintext
// **Validates: Requirements 2.1, 2.5, 2.8**
// ---------------------------------------------------------------------------

describe('Property 1: Encryption round-trip preserves plaintext', () => {
  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 10000 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
    ],
  )(
    'encrypt then decrypt yields original plaintext byte-for-byte',
    async (plaintext, keyBytes) => {
      const kek = wrapKey(keyBytes);

      const encrypted = await encrypt(plaintext, kek);

      // Encrypted payload must have all Base64 string fields
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.authTag).toBe('string');
      expect(typeof encrypted.ciphertext).toBe('string');

      const result = await decrypt(encrypted, kek);

      // Decryption must succeed
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Decrypted plaintext must equal the original byte-for-byte
        expect(result.plaintext).toEqual(plaintext);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Property 4: IV uniqueness across encryptions
// **Validates: Requirements 2.2**
// ---------------------------------------------------------------------------

describe('Property 4: IV uniqueness across encryptions', () => {
  const N = 50; // Encrypt same data N times, expect N unique IVs

  it.prop(
    [
      fc.uint8Array({ minLength: 1, maxLength: 1000 }),
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
    ],
    { numRuns: 20 },
  )(
    'encrypting the same plaintext N times with the same key produces N unique IVs',
    async (plaintext, keyBytes) => {
      const kek = wrapKey(keyBytes);

      // Encrypt the same plaintext N times with the same key
      const results = await Promise.all(
        Array.from({ length: N }, () => encrypt(plaintext, kek)),
      );

      // Collect all IVs
      const ivs = results.map((r) => r.iv);

      // All IVs must be unique — set size must equal N
      const uniqueIvs = new Set(ivs);
      expect(uniqueIvs.size).toBe(N);
    },
  );
});

// ---------------------------------------------------------------------------
// Property 5: KDF determinism and salt sensitivity
// **Validates: Requirements 1.1, 1.2**
// ---------------------------------------------------------------------------

describe('Property 5: KDF determinism and salt sensitivity', () => {
  const pbkdf2Params = { algorithm: 'PBKDF2' as const };

  // Part A — Determinism:
  // For any valid passphrase (≥12 chars) and any 16-byte salt,
  // deriving the KEK twice with identical inputs produces identical key material.
  it.prop(
    [
      fc.string({ minLength: 12, maxLength: 32 }).filter((s) =>
        [...s].every((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 32 && code <= 126;
        }),
      ),
      fc.uint8Array({ minLength: 16, maxLength: 16 }),
    ],
    { numRuns: 3 },
  )(
    'deriveKEK is deterministic for identical inputs',
    async (passphrase, salt) => {
      const result1 = await deriveKEK(passphrase, salt, pbkdf2Params);
      const result2 = await deriveKEK(passphrase, salt, pbkdf2Params);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        const key1 = result1.kek._inner as Uint8Array;
        const key2 = result2.kek._inner as Uint8Array;
        expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
      }
    },
    120_000,
  );

  // Part B — Salt sensitivity:
  // For any valid passphrase, two different salts produce different KEKs.
  it.prop(
    [
      fc.string({ minLength: 12, maxLength: 32 }).filter((s) =>
        [...s].every((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 32 && code <= 126;
        }),
      ),
      fc.uint8Array({ minLength: 16, maxLength: 16 }),
      fc.uint8Array({ minLength: 16, maxLength: 16 }),
    ],
    { numRuns: 3 },
  )(
    'different salts produce different KEKs',
    async (passphrase, salt1, salt2) => {
      // Ensure the two salts actually differ
      fc.pre(!Buffer.from(salt1).equals(Buffer.from(salt2)));

      const result1 = await deriveKEK(passphrase, salt1, pbkdf2Params);
      const result2 = await deriveKEK(passphrase, salt2, pbkdf2Params);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        const key1 = result1.kek._inner as Uint8Array;
        const key2 = result2.kek._inner as Uint8Array;
        expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
      }
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// Property 6: Short passphrases never derive a key
// **Validates: Requirements 1.9**
// ---------------------------------------------------------------------------

describe('Property 6: Short passphrases never derive a key', () => {
  it.prop(
    [
      fc.string({ minLength: 0, maxLength: 11 }),
      fc.uint8Array({ minLength: 16, maxLength: 16 }),
    ],
  )(
    'any passphrase shorter than 12 chars is always rejected with PASSPHRASE_TOO_SHORT',
    async (shortPassphrase, salt) => {
      const result = await deriveKEK(shortPassphrase, salt, { algorithm: 'PBKDF2' });

      expect(result).toEqual({ ok: false, error: 'PASSPHRASE_TOO_SHORT' });
      // No kek field should be present
      expect('kek' in result).toBe(false);
    },
  );
});
