/**
 * Install Web Crypto on React Native before any @complex-patient/crypto-engine import.
 *
 * expo-standard-web-crypto only polyfills getRandomValues. Vault encrypt/decrypt
 * needs SubtleCrypto (AES-256-GCM). Browsers already provide it; Hermes does not.
 */

import { polyfillWebCrypto } from 'expo-standard-web-crypto';
import { installNativeSubtlePolyfill } from './native-crypto-subtle';

polyfillWebCrypto();

function hasAesGcmSubtle(): boolean {
  return (
    typeof globalThis.crypto?.subtle?.encrypt === 'function' &&
    typeof globalThis.crypto?.subtle?.decrypt === 'function'
  );
}

if (!hasAesGcmSubtle()) {
  installNativeSubtlePolyfill();
}
