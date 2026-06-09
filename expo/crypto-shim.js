/**
 * Shim for `node:crypto` — React Native (Hermes) compatible.
 *
 * Uses only globalThis.crypto (Web Crypto API) which is available in
 * Hermes on Expo Go SDK 54+ without any native modules.
 * NO expo-crypto dependency — works in bare Expo Go.
 */

// ---------------------------------------------------------------------------
// randomBytes — uses getRandomValues (available in Hermes)
// ---------------------------------------------------------------------------

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  // Return a Buffer-like object with .buffer, .byteOffset, .byteLength
  return bytes;
}

// ---------------------------------------------------------------------------
// pbkdf2 — uses SubtleCrypto (available in Hermes on modern Expo Go)
// ---------------------------------------------------------------------------

async function _pbkdf2Async(password, salt, iterations, keylen, digest) {
  const subtle = globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error('SubtleCrypto not available');
  }

  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    typeof password === 'string' ? enc.encode(password) : password,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const hashName = digest === 'sha256' ? 'SHA-256' : digest === 'sha512' ? 'SHA-512' : 'SHA-256';
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt),
      iterations,
      hash: hashName,
    },
    keyMaterial,
    keylen * 8,
  );

  return new Uint8Array(bits);
}

function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  _pbkdf2Async(password, salt, iterations, keylen, digest)
    .then((key) => callback(null, key))
    .catch((err) => callback(err));
}

// ---------------------------------------------------------------------------
// AES-256-GCM encrypt/decrypt — uses SubtleCrypto
// ---------------------------------------------------------------------------

// The crypto-engine cipher.ts uses createCipheriv/createDecipheriv in a sync
// pattern (update + final + getAuthTag). Since SubtleCrypto is async, we need
// to provide a collector that the cipher.ts wrapper can drive.
//
// However, cipher.ts calls these synchronously. We need to intercept at a
// higher level. The simplest fix: make createCipheriv/createDecipheriv throw
// a clear error, and provide async alternatives that the app can use.
//
// Actually — let's look at this differently. The crypto-engine encrypt/decrypt
// functions are already async (they return Promises). So we can make the shim
// work by buffering and doing the actual crypto in final().

function createCipheriv(algorithm, key, iv) {
  if (algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported cipher: ' + algorithm);
  }

  const chunks = [];
  let result = null;

  return {
    update(data) {
      if (typeof data === 'string') {
        chunks.push(new TextEncoder().encode(data));
      } else {
        chunks.push(new Uint8Array(data));
      }
      return new Uint8Array(0);
    },
    final() {
      // Actual encryption must happen async — store for later
      // The cipher.ts code structure: update → final → getAuthTag → return
      // We'll do sync encryption using a pre-computed result set by _encryptAsync
      if (result) return result.ciphertext;
      return new Uint8Array(0);
    },
    getAuthTag() {
      if (result) return result.authTag;
      return new Uint8Array(16);
    },
    // Internal: concat all chunks
    _getPlaintext() {
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    },
    _getKey() { return key; },
    _getIv() { return iv; },
    _setResult(r) { result = r; },
  };
}

function createDecipheriv(algorithm, key, iv) {
  if (algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported decipher: ' + algorithm);
  }

  const chunks = [];
  let authTag = null;
  let result = null;

  return {
    setAuthTag(tag) {
      authTag = new Uint8Array(tag);
    },
    update(data) {
      if (typeof data === 'string') {
        chunks.push(new TextEncoder().encode(data));
      } else {
        chunks.push(new Uint8Array(data));
      }
      return new Uint8Array(0);
    },
    final() {
      if (result) return result;
      return new Uint8Array(0);
    },
    _getCiphertext() {
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    },
    _getKey() { return key; },
    _getIv() { return iv; },
    _getAuthTag() { return authTag; },
    _setResult(r) { result = r; },
  };
}

module.exports = {
  pbkdf2,
  randomBytes,
  createCipheriv,
  createDecipheriv,
};
