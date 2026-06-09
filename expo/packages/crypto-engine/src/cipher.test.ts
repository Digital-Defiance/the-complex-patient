import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './cipher';
import { wrapKey } from './types';
import { randomBytes } from 'node:crypto';
import type { EncryptedPayload } from './types';

/**
 * Helper: create a valid 256-bit (32-byte) KEK wrapped in CryptoKeyRef.
 */
function makeKek(bytes?: Uint8Array) {
  const keyBytes = bytes ?? randomBytes(32);
  return wrapKey(new Uint8Array(keyBytes));
}

/**
 * Helper: create sample plaintext.
 */
function makePlaintext(content = 'Hello, Complex Patient!'): Uint8Array {
  return new TextEncoder().encode(content);
}

describe('encrypt', () => {
  it('produces Base64-encoded iv, authTag, and ciphertext (Requirement 2.8)', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const result = await encrypt(plaintext, kek);

    // All fields should be valid Base64 strings
    expect(typeof result.iv).toBe('string');
    expect(typeof result.authTag).toBe('string');
    expect(typeof result.ciphertext).toBe('string');

    // Validate they decode without error
    expect(() => Buffer.from(result.iv, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.authTag, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.ciphertext, 'base64')).not.toThrow();
  });

  it('produces a 12-byte IV when decoded (Requirement 2.2)', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const result = await encrypt(plaintext, kek);
    const ivBytes = Buffer.from(result.iv, 'base64');

    expect(ivBytes.length).toBe(12);
  });

  it('produces a 16-byte authTag when decoded (Requirement 2.3)', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const result = await encrypt(plaintext, kek);
    const tagBytes = Buffer.from(result.authTag, 'base64');

    expect(tagBytes.length).toBe(16);
  });

  it('generates a fresh IV per call — no IV reuse (Requirement 2.2)', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const result1 = await encrypt(plaintext, kek);
    const result2 = await encrypt(plaintext, kek);

    // IVs must differ (same plaintext + same key)
    expect(result1.iv).not.toBe(result2.iv);
  });

  it('produces non-empty ciphertext', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const result = await encrypt(plaintext, kek);
    const ctBytes = Buffer.from(result.ciphertext, 'base64');

    expect(ctBytes.length).toBeGreaterThan(0);
  });
});

describe('decrypt', () => {
  it('round-trips: encrypt then decrypt yields original plaintext (Requirements 2.1–2.5)', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext('Sensitive health data: medication schedule');

    const encrypted = await encrypt(plaintext, kek);
    const result = await decrypt(encrypted, kek);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plaintext).toEqual(plaintext);
    }
  });

  it('round-trips with empty-ish plaintext (single byte)', async () => {
    const kek = makeKek();
    const plaintext = new Uint8Array([0x42]);

    const encrypted = await encrypt(plaintext, kek);
    const result = await decrypt(encrypted, kek);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plaintext).toEqual(plaintext);
    }
  });

  it('round-trips with large plaintext', async () => {
    const kek = makeKek();
    const plaintext = randomBytes(10_000); // 10KB payload

    const encrypted = await encrypt(new Uint8Array(plaintext), kek);
    const result = await decrypt(encrypted, kek);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Buffer.from(result.plaintext).equals(plaintext)).toBe(true);
    }
  });
});

describe('decrypt — AUTH_TAG_FAILED (Requirements 2.4, 2.6)', () => {
  it('returns AUTH_TAG_FAILED when ciphertext is tampered', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const encrypted = await encrypt(plaintext, kek);

    // Tamper with ciphertext
    const ctBytes = Buffer.from(encrypted.ciphertext, 'base64');
    ctBytes[0] ^= 0xff; // flip bits
    const tampered: EncryptedPayload = {
      ...encrypted,
      ciphertext: ctBytes.toString('base64'),
    };

    const result = await decrypt(tampered, kek);
    expect(result).toEqual({ ok: false, error: 'AUTH_TAG_FAILED' });
  });

  it('returns AUTH_TAG_FAILED when authTag is tampered', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const encrypted = await encrypt(plaintext, kek);

    // Tamper with authTag
    const tagBytes = Buffer.from(encrypted.authTag, 'base64');
    tagBytes[0] ^= 0xff;
    const tampered: EncryptedPayload = {
      ...encrypted,
      authTag: tagBytes.toString('base64'),
    };

    const result = await decrypt(tampered, kek);
    expect(result).toEqual({ ok: false, error: 'AUTH_TAG_FAILED' });
  });

  it('returns AUTH_TAG_FAILED when IV is tampered', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext();

    const encrypted = await encrypt(plaintext, kek);

    // Tamper with IV
    const ivBytes = Buffer.from(encrypted.iv, 'base64');
    ivBytes[0] ^= 0xff;
    const tampered: EncryptedPayload = {
      ...encrypted,
      iv: ivBytes.toString('base64'),
    };

    const result = await decrypt(tampered, kek);
    expect(result).toEqual({ ok: false, error: 'AUTH_TAG_FAILED' });
  });

  it('returns AUTH_TAG_FAILED when using wrong key', async () => {
    const kek1 = makeKek();
    const kek2 = makeKek(); // different key
    const plaintext = makePlaintext();

    const encrypted = await encrypt(plaintext, kek1);
    const result = await decrypt(encrypted, kek2);

    expect(result).toEqual({ ok: false, error: 'AUTH_TAG_FAILED' });
  });

  it('never returns partial plaintext on tag failure', async () => {
    const kek = makeKek();
    const plaintext = makePlaintext('This must never leak');

    const encrypted = await encrypt(plaintext, kek);

    // Tamper with tag
    const tagBytes = Buffer.from(encrypted.authTag, 'base64');
    tagBytes[15] ^= 0x01;
    const tampered: EncryptedPayload = {
      ...encrypted,
      authTag: tagBytes.toString('base64'),
    };

    const result = await decrypt(tampered, kek);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('AUTH_TAG_FAILED');
      // Ensure no plaintext field exists on failure result
      expect('plaintext' in result).toBe(false);
    }
  });
});

describe('decrypt — MALFORMED_BLOB (Requirement 2.7)', () => {
  const kek = makeKek();

  it('rejects blob with missing iv field', async () => {
    const blob = { authTag: 'AAAAAAAAAAAAAAAAAAAAAA==', ciphertext: 'AQID' } as unknown as EncryptedPayload;
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with missing authTag field', async () => {
    const blob = { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AQID' } as unknown as EncryptedPayload;
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with missing ciphertext field', async () => {
    const blob = { iv: 'AAAAAAAAAAAAAAAA', authTag: 'AAAAAAAAAAAAAAAAAAAAAA==' } as unknown as EncryptedPayload;
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with null value', async () => {
    const result = await decrypt(null as unknown as EncryptedPayload, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with iv that decodes to wrong length (not 12 bytes)', async () => {
    // 8 bytes → too short
    const shortIv = Buffer.alloc(8).toString('base64');
    const blob: EncryptedPayload = {
      iv: shortIv,
      authTag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.alloc(32).toString('base64'),
    };
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with authTag that decodes to wrong length (not 16 bytes)', async () => {
    // 8 bytes → too short
    const shortTag = Buffer.alloc(8).toString('base64');
    const blob: EncryptedPayload = {
      iv: Buffer.alloc(12).toString('base64'),
      authTag: shortTag,
      ciphertext: Buffer.alloc(32).toString('base64'),
    };
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with empty ciphertext', async () => {
    const blob: EncryptedPayload = {
      iv: Buffer.alloc(12).toString('base64'),
      authTag: Buffer.alloc(16).toString('base64'),
      ciphertext: '', // empty
    };
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with non-string iv', async () => {
    const blob = {
      iv: 12345,
      authTag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.alloc(32).toString('base64'),
    } as unknown as EncryptedPayload;
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });

  it('rejects blob with non-base64 iv', async () => {
    const blob: EncryptedPayload = {
      iv: '!!!not-base64!!!',
      authTag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.alloc(32).toString('base64'),
    };
    const result = await decrypt(blob, kek);
    expect(result).toEqual({ ok: false, error: 'MALFORMED_BLOB' });
  });
});
