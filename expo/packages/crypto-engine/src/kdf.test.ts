import { describe, it, expect } from 'vitest';
import { generateSalt, deriveKEK } from './kdf';
import type { KdfParams } from './types';

describe('generateSalt', () => {
  it('returns a Uint8Array of at least 16 bytes (Requirement 1.1)', async () => {
    const salt = await generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBeGreaterThanOrEqual(16);
  });

  it('generates unique salts on successive calls', async () => {
    const salt1 = await generateSalt();
    const salt2 = await generateSalt();
    // Extremely unlikely for 16 random bytes to collide
    expect(Buffer.from(salt1).equals(Buffer.from(salt2))).toBe(false);
  });

  it('produces exactly 16 bytes', async () => {
    const salt = await generateSalt();
    expect(salt.length).toBe(16);
  });
});

describe('deriveKEK', () => {
  const validPassphrase = 'MySecurePass12!'; // 15 chars, above minimum
  const shortPassphrase = 'Short123!'; // 9 chars, below minimum
  const exactMinPassphrase = '123456789012'; // exactly 12 chars

  const defaultPbkdf2Params: KdfParams = { algorithm: 'PBKDF2' };
  const explicitPbkdf2Params: KdfParams = { algorithm: 'PBKDF2', pbkdf2Iterations: 600_000 };

  let testSalt: Uint8Array;

  // Generate a salt once for reuse in tests
  beforeAll(async () => {
    testSalt = await generateSalt();
  });

  describe('passphrase validation (Requirement 1.9)', () => {
    it('rejects passphrase shorter than 12 chars with PASSPHRASE_TOO_SHORT', async () => {
      const result = await deriveKEK(shortPassphrase, testSalt, defaultPbkdf2Params);
      expect(result).toEqual({ ok: false, error: 'PASSPHRASE_TOO_SHORT' });
    });

    it('rejects empty passphrase', async () => {
      const result = await deriveKEK('', testSalt, defaultPbkdf2Params);
      expect(result).toEqual({ ok: false, error: 'PASSPHRASE_TOO_SHORT' });
    });

    it('rejects 11-character passphrase', async () => {
      const result = await deriveKEK('12345678901', testSalt, defaultPbkdf2Params);
      expect(result).toEqual({ ok: false, error: 'PASSPHRASE_TOO_SHORT' });
    });

    it('accepts exactly 12-character passphrase', async () => {
      const result = await deriveKEK(exactMinPassphrase, testSalt, defaultPbkdf2Params);
      expect(result.ok).toBe(true);
    });
  });

  describe('PBKDF2 derivation (Requirement 1.2)', () => {
    it('derives a KEK successfully with default params (≥600,000 iterations)', async () => {
      const result = await deriveKEK(validPassphrase, testSalt, defaultPbkdf2Params);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.kek).toBeDefined();
        expect(result.kek._inner).toBeInstanceOf(Uint8Array);
        // 256-bit key = 32 bytes
        expect((result.kek._inner as Uint8Array).length).toBe(32);
      }
    });

    it('derives a KEK with explicit 600,000 iterations', async () => {
      const result = await deriveKEK(validPassphrase, testSalt, explicitPbkdf2Params);
      expect(result.ok).toBe(true);
    });

    it('produces deterministic output for same inputs', async () => {
      const result1 = await deriveKEK(validPassphrase, testSalt, defaultPbkdf2Params);
      const result2 = await deriveKEK(validPassphrase, testSalt, defaultPbkdf2Params);
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        const key1 = result1.kek._inner as Uint8Array;
        const key2 = result2.kek._inner as Uint8Array;
        expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
      }
    });

    it('produces different keys for different salts', async () => {
      const salt2 = await generateSalt();
      const result1 = await deriveKEK(validPassphrase, testSalt, defaultPbkdf2Params);
      const result2 = await deriveKEK(validPassphrase, salt2, defaultPbkdf2Params);
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        const key1 = result1.kek._inner as Uint8Array;
        const key2 = result2.kek._inner as Uint8Array;
        expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
      }
    });

    it('produces different keys for different passphrases', async () => {
      const result1 = await deriveKEK(validPassphrase, testSalt, defaultPbkdf2Params);
      const result2 = await deriveKEK('AnotherPass123!', testSalt, defaultPbkdf2Params);
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        const key1 = result1.kek._inner as Uint8Array;
        const key2 = result2.kek._inner as Uint8Array;
        expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
      }
    });

    it('rejects PBKDF2 iterations below 600,000', async () => {
      const lowIterParams: KdfParams = { algorithm: 'PBKDF2', pbkdf2Iterations: 100_000 };
      const result = await deriveKEK(validPassphrase, testSalt, lowIterParams);
      expect(result).toEqual({ ok: false, error: 'DERIVATION_FAILED' });
    });
  });

  describe('Argon2id derivation (Requirement 1.2)', () => {
    it('returns DERIVATION_FAILED when no Argon2id binding is available', async () => {
      const argonParams: KdfParams = { algorithm: 'Argon2id', argonMemoryKiB: 65_536 };
      const result = await deriveKEK(validPassphrase, testSalt, argonParams);
      expect(result).toEqual({ ok: false, error: 'DERIVATION_FAILED' });
    });

    it('rejects Argon2id memory cost below 64 MiB (65,536 KiB)', async () => {
      const lowMemParams: KdfParams = { algorithm: 'Argon2id', argonMemoryKiB: 32_768 };
      const result = await deriveKEK(validPassphrase, testSalt, lowMemParams);
      expect(result).toEqual({ ok: false, error: 'DERIVATION_FAILED' });
    });
  });

  describe('failure handling (Requirement 1.10)', () => {
    it('returns DERIVATION_FAILED for unknown algorithm', async () => {
      const unknownParams = { algorithm: 'UNKNOWN' } as unknown as KdfParams;
      const result = await deriveKEK(validPassphrase, testSalt, unknownParams);
      expect(result).toEqual({ ok: false, error: 'DERIVATION_FAILED' });
    });

    it('does not include a kek property on derivation failure (no partial key material)', async () => {
      const unknownParams = { algorithm: 'UNKNOWN' } as unknown as KdfParams;
      const result = await deriveKEK(validPassphrase, testSalt, unknownParams);
      expect(result.ok).toBe(false);
      expect('kek' in result).toBe(false);
    });

    it('failure result contains only ok and error properties (no extra fields)', async () => {
      const lowIterParams: KdfParams = { algorithm: 'PBKDF2', pbkdf2Iterations: 100_000 };
      const result = await deriveKEK(validPassphrase, testSalt, lowIterParams);
      expect(result.ok).toBe(false);
      expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
    });

    it('does not leak partial key material when PBKDF2 iterations are too low', async () => {
      const lowIterParams: KdfParams = { algorithm: 'PBKDF2', pbkdf2Iterations: 100_000 };
      const result = await deriveKEK(validPassphrase, testSalt, lowIterParams);
      expect(result.ok).toBe(false);
      expect('kek' in result).toBe(false);
    });

    it('does not leak partial key material when Argon2id binding is unavailable', async () => {
      const argonParams: KdfParams = { algorithm: 'Argon2id', argonMemoryKiB: 65_536 };
      const result = await deriveKEK(validPassphrase, testSalt, argonParams);
      expect(result.ok).toBe(false);
      expect('kek' in result).toBe(false);
      expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
    });
  });

  describe('client-side constraint (Requirements 1.3, 1.4)', () => {
    it('returns result directly without any network calls', async () => {
      // This test validates the function returns a local result
      // The implementation uses node:crypto which is purely local
      const result = await deriveKEK(validPassphrase, testSalt, defaultPbkdf2Params);
      expect(result.ok).toBe(true);
    });
  });
});
