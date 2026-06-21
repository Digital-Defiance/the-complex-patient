/**
 * WinZip AES-256 encryption via Web Crypto (hardware-accelerated).
 *
 * zip.js uses SJCL for AES-CTR + HMAC in JavaScript, which is very slow on
 * large exports. This module reproduces the same WinZip AES format using
 * SubtleCrypto for PBKDF2, AES-CTR keystream (Gladman counter), and HMAC-SHA1.
 */

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const VERIFIER_LENGTH = 2;
const SIGNATURE_LENGTH = 10;
const BLOCK_LENGTH = 16;

const PBKDF2_ITERATIONS = 1000;

export function canUseWinZipAesWebCrypto(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.importKey === 'function' &&
    typeof globalThis.crypto.subtle.deriveBits === 'function' &&
    typeof globalThis.crypto.subtle.encrypt === 'function' &&
    typeof globalThis.crypto.subtle.sign === 'function'
  );
}

/** Brian Gladman counter increment (matches zip.js / SJCL ctrGladman). */
function incWord(word: number): number {
  if (((word >>> 24) & 0xff) === 0xff) {
    let b1 = (word >>> 16) & 0xff;
    let b2 = (word >>> 8) & 0xff;
    let b3 = word & 0xff;

    if (b1 === 0xff) {
      b1 = 0;
      if (b2 === 0xff) {
        b2 = 0;
        if (b3 === 0xff) {
          b3 = 0;
        } else {
          b3 += 1;
        }
      } else {
        b2 += 1;
      }
    } else {
      b1 += 1;
    }

    return (b1 << 16) | (b2 << 8) | b3;
  }
  return word + (0x01 << 24);
}

function incCounter(counter: Uint32Array): void {
  counter[0] = incWord(counter[0]);
  if (counter[0] === 0) {
    counter[1] = incWord(counter[1]);
  }
}

function counterToIv(counter: Uint32Array): Uint8Array {
  const iv = new Uint8Array(BLOCK_LENGTH);
  const view = new DataView(iv.buffer);
  view.setUint32(0, counter[0], false);
  view.setUint32(4, counter[1], false);
  view.setUint32(8, counter[2], false);
  view.setUint32(12, counter[3], false);
  return iv;
}

async function deriveWinZipAes256Keys(
  password: string,
  salt: Uint8Array,
): Promise<{ aesKey: CryptoKey; hmacKey: CryptoKey; passwordVerifier: Uint8Array }> {
  const passBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', passBytes, { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-1',
    },
    baseKey,
    8 * (KEY_LENGTH * 2 + VERIFIER_LENGTH),
  );

  const composite = new Uint8Array(derivedBits);
  const aesKeyBytes = composite.subarray(0, KEY_LENGTH);
  const hmacKeyBytes = composite.subarray(KEY_LENGTH, KEY_LENGTH * 2);
  const passwordVerifier = composite.subarray(KEY_LENGTH * 2);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    aesKeyBytes,
    { name: 'AES-CTR', length: 256 },
    false,
    ['encrypt'],
  );
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    hmacKeyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  return { aesKey, hmacKey, passwordVerifier };
}

async function gladmanKeystreamBlock(aesKey: CryptoKey, counter: Uint32Array): Promise<Uint8Array> {
  const iv = counterToIv(counter);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter: iv, length: 128 },
    aesKey,
    new Uint8Array(BLOCK_LENGTH),
  );
  return new Uint8Array(encrypted);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmacSha1(hmacKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign('HMAC', hmacKey, data);
  return new Uint8Array(signature).subarray(0, SIGNATURE_LENGTH);
}

async function encryptBody(aesKey: CryptoKey, hmacKey: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const counter = new Uint32Array([0, 0, 0, 0]);
  const encrypted = new Uint8Array(plaintext.length);
  let offset = 0;

  while (offset + BLOCK_LENGTH <= plaintext.length) {
    incCounter(counter);
    const keystream = await gladmanKeystreamBlock(aesKey, counter);
    for (let i = 0; i < BLOCK_LENGTH; i += 1) {
      encrypted[offset + i] = plaintext[offset + i] ^ keystream[i];
    }
    offset += BLOCK_LENGTH;
  }

  const remainder = plaintext.length - offset;
  if (remainder > 0) {
    incCounter(counter);
    const keystream = await gladmanKeystreamBlock(aesKey, counter);
    for (let i = 0; i < remainder; i += 1) {
      encrypted[offset + i] = plaintext[offset + i] ^ keystream[i];
    }
  }

  const authCode = await hmacSha1(hmacKey, encrypted);
  return concat(encrypted, authCode);
}

/**
 * Encrypt plaintext with WinZip AES-256 (AE-2 format).
 * Returns salt + password verifier + ciphertext + 10-byte auth code.
 */
export async function encryptWinZipAes256(
  plaintext: Uint8Array,
  password: string,
  salt?: Uint8Array,
): Promise<Uint8Array> {
  if (!canUseWinZipAesWebCrypto()) {
    throw new Error('Web Crypto is unavailable for WinZip AES encryption.');
  }

  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const { aesKey, hmacKey, passwordVerifier } = await deriveWinZipAes256Keys(password, useSalt);
  const encryptedPayload = await encryptBody(aesKey, hmacKey, plaintext);
  return concat(useSalt, passwordVerifier, encryptedPayload);
}
