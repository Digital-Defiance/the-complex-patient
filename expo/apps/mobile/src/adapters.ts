/**
 * @complex-patient/mobile — Native platform adapters
 *
 * Concrete implementations of the FIXED key-store / device-storage interfaces
 * (`@complex-patient/key-store`, `@complex-patient/ui`). This module is the only
 * place native Expo modules are imported, so the rest of the shell stays
 * testable under vitest (the conformance tests exercise in-memory backends that
 * implement the same contracts — see Property 13).
 */

import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import type { KekCodec } from '@complex-patient/key-store';
import type { DeviceFlagStorage } from '@complex-patient/ui';

import * as SecureStore from 'expo-secure-store';
import { createDeviceFlagStorage } from '../../device-flag-storage';

// ---------------------------------------------------------------------------
// KekCodec (Requirement 14.3) — used by the NativeSessionKeyStore
// ---------------------------------------------------------------------------

/**
 * Reversible codec between a {@link CryptoKeyRef} and an opaque string for the
 * device Secure Enclave. The KEK's inner material is raw bytes (`wrapKey(
 * Uint8Array)` from the KDF); the codec serializes them to Base64 for the
 * enclave and re-`wrapKey`s on read so the SAME KEK is restored after a
 * biometric unlock. It MUST round-trip exactly:
 *
 *   deserialize(serialize(kek))  →  CryptoKeyRef with identical key bytes.
 */
export function createKekCodec(): KekCodec {
  return {
    serialize(kek: CryptoKeyRef): string {
      const bytes = kek._inner as Uint8Array;
      return base64FromBytes(bytes);
    },
    deserialize(serialized: string): CryptoKeyRef {
      return wrapKey(bytesFromBase64(serialized));
    },
  };
}

// ---------------------------------------------------------------------------
// Device ineligibility-flag storage (Requirement 14.3)
// ---------------------------------------------------------------------------

/**
 * Native backing store for the age-gate ineligibility flag, kept OUTSIDE the
 * encrypted Local_Vault so it is readable at launch without a KEK. Backed by
 * `expo-secure-store`; both `getItemAsync` / `setItemAsync` satisfy the async
 * arm of {@link DeviceFlagStorage}.
 */
export const nativeFlagStorage: DeviceFlagStorage = createDeviceFlagStorage({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
});

/** Non-secret KDF salt/params for unlock — same SecureStore backend as flags. */
export const nativeKdfStorage = nativeFlagStorage;

// ---------------------------------------------------------------------------
// Portable Base64 (no Buffer / btoa dependency)
// ---------------------------------------------------------------------------
//
// Hermes (React Native) does not expose Node's `Buffer` and only inconsistently
// exposes `btoa`/`atob`, so we use a self-contained, lossless implementation
// that round-trips arbitrary bytes on every platform.

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode raw bytes to a standard (padded) Base64 string. */
function base64FromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

/** Decode a standard Base64 string back to the exact original bytes. */
function bytesFromBase64(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);

  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;

  for (let i = 0; i < clean.length; i++) {
    const value = BASE64_ALPHABET.indexOf(clean[i]);
    if (value === -1) {
      throw new Error('invalid Base64 input');
    }
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }

  return bytes;
}
