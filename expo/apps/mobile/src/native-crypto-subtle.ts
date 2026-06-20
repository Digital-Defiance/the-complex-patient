/**
 * Minimal SubtleCrypto polyfill for Hermes using @noble/ciphers AES-GCM.
 *
 * cipher.ts needs importKey + encrypt + decrypt for AES-256-GCM. Browsers and
 * secure web contexts already provide these; React Native does not.
 */

import { gcm } from '@noble/ciphers/aes.js';

type RawAesGcmKey = CryptoKey & { __rawKey: Uint8Array };

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function installNativeSubtlePolyfill(): void {
  const subtle: Pick<SubtleCrypto, 'importKey' | 'encrypt' | 'decrypt'> = {
    async importKey(
      format: 'raw',
      keyData: ArrayBuffer | Uint8Array,
      algorithm: { name: string },
      _extractable: boolean,
      keyUsages: KeyUsage[],
    ): Promise<CryptoKey> {
      if (format !== 'raw' || algorithm.name !== 'AES-GCM') {
        throw new DOMException('Unsupported importKey parameters', 'NotSupportedError');
      }
      const bytes = toBytes(keyData);
      if (bytes.length !== 32) {
        throw new DOMException('Invalid AES-GCM key length', 'DataError');
      }
      return {
        __rawKey: bytes,
        algorithm,
        type: 'secret',
        extractable: false,
        usages: keyUsages,
      } as RawAesGcmKey;
    },

    async encrypt(
      algorithm: AesGcmParams,
      key: CryptoKey,
      data: ArrayBuffer | Uint8Array,
    ): Promise<ArrayBuffer> {
      if (algorithm.name !== 'AES-GCM') {
        throw new DOMException('Unsupported encrypt algorithm', 'NotSupportedError');
      }
      const rawKey = (key as RawAesGcmKey).__rawKey;
      const iv = toBytes(algorithm.iv);
      const plaintext = toBytes(data);
      const combined = gcm(rawKey, iv).encrypt(plaintext);
      return toArrayBuffer(combined);
    },

    async decrypt(
      algorithm: AesGcmParams,
      key: CryptoKey,
      data: ArrayBuffer | Uint8Array,
    ): Promise<ArrayBuffer> {
      if (algorithm.name !== 'AES-GCM') {
        throw new DOMException('Unsupported decrypt algorithm', 'NotSupportedError');
      }
      const rawKey = (key as RawAesGcmKey).__rawKey;
      const iv = toBytes(algorithm.iv);
      const combined = toBytes(data);
      try {
        const plaintext = gcm(rawKey, iv).decrypt(combined);
        return toArrayBuffer(plaintext);
      } catch {
        throw new DOMException('Authentication tag verification failed', 'OperationError');
      }
    },
  };

  const existing = globalThis.crypto;
  const getRandomValues =
    typeof existing?.getRandomValues === 'function'
      ? existing.getRandomValues.bind(existing)
      : (values: ArrayBufferView) => {
          for (let i = 0; i < values.byteLength; i++) {
            (values as Uint8Array)[i] = Math.floor(Math.random() * 256);
          }
          return values;
        };

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: true,
    value: {
      ...existing,
      getRandomValues,
      subtle,
    },
  });
}
