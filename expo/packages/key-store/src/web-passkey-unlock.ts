/**
 * Web passkey unlock — fast vault unlock without PBKDF2 re-derivation.
 *
 * Uses WebAuthn with the PRF extension to derive a wrapping key that encrypts
 * the KEK in localStorage. The master passphrase is still required for first
 * unlock and whenever passkey unlock is unavailable.
 *
 * Security notes:
 * - The KEK is never stored in plaintext on web.
 * - Wrapped KEK is useless without the passkey PRF output + user verification.
 * - This is weaker than native Secure Enclave storage but avoids ~600k PBKDF2 on
 *   every tab return.
 */

import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';

export const WEB_PASSKEY_UNLOCK_STORAGE_KEY = 'complex-patient.web-passkey-unlock';

/** Set after passphrase unlock when the user opts in; cleared when home prompts setup. */
export const PASSKEY_SETUP_SESSION_KEY = 'complex-patient.offer-passkey-setup';

/** Map machine-readable passkey errors to user-facing copy. */
export function formatPasskeyUnlockError(code: string): string {
  switch (code) {
    case 'PASSKEY_PRF_UNAVAILABLE':
      return 'This browser does not support passkey unlock (PRF extension). Use Chrome 118+ or Safari 17.4+ on this device.';
    case 'PASSKEY_CANCELLED':
      return 'Passkey setup was cancelled.';
    case 'PASSKEY_UNSUPPORTED':
      return 'Passkeys are not supported in this browser.';
    case 'PASSKEY_RP_MISMATCH':
      return 'The saved passkey was created on a different site. Set up passkey unlock again on this browser.';
    case 'PASSKEY_DECRYPT_FAILED':
      return 'The saved passkey could not unlock your vault. Set it up again with your master passphrase.';
    case 'PASSKEY_NOT_REGISTERED':
      return 'No passkey is saved on this browser yet.';
    case 'Passkey unlock is not configured.':
      return 'Passkey unlock is not active in this browser session. Refresh the page, unlock again, then retry.';
    default:
      return code;
  }
}

export interface PasskeyUnlockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Browser localStorage backing for PRF-wrapped KEK metadata. */
export function createBrowserPasskeyStorage(): PasskeyUnlockStorage {
  return {
    getItem(key) {
      if (typeof globalThis.localStorage === 'undefined') {
        return null;
      }
      return globalThis.localStorage.getItem(key);
    },
    setItem(key, value) {
      if (typeof globalThis.localStorage !== 'undefined') {
        globalThis.localStorage.setItem(key, value);
      }
    },
    removeItem(key) {
      if (typeof globalThis.localStorage !== 'undefined') {
        globalThis.localStorage.removeItem(key);
      }
    },
  };
}

export interface BrowserPasskeyUnlockDeps {
  storage: PasskeyUnlockStorage;
  getRpId?: () => string;
}

/** Default passkey unlock wiring when running in a browser (localStorage + current hostname). */
export function resolveBrowserPasskeyUnlockDeps(): BrowserPasskeyUnlockDeps | undefined {
  if (typeof globalThis.window === 'undefined') {
    return undefined;
  }
  return {
    storage: createBrowserPasskeyStorage(),
    getRpId: () => {
      const hostname = globalThis.window.location?.hostname;
      return hostname && hostname.length > 0 ? hostname : 'localhost';
    },
  };
}

interface StoredPasskeyUnlock {
  version: 1;
  rpId: string;
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
}

interface AuthenticationExtensionsClientInputs {
  prf?: {
    eval?: {
      first?: BufferSource;
    };
  };
}

interface AuthenticationExtensionsClientOutputs {
  prf?: {
    results?: {
      first?: ArrayBuffer;
    };
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary =
    typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function kekBytes(kek: CryptoKeyRef): Uint8Array {
  const inner = kek._inner;
  if (!(inner instanceof Uint8Array)) {
    throw new Error('passkey unlock requires raw-byte KEK material');
  }
  return inner;
}

function readStoredRecord(storage: PasskeyUnlockStorage): StoredPasskeyUnlock | null {
  const raw = storage.getItem(WEB_PASSKEY_UNLOCK_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredPasskeyUnlock;
    if (
      parsed.version !== 1 ||
      typeof parsed.rpId !== 'string' ||
      typeof parsed.credentialId !== 'string' ||
      typeof parsed.prfSalt !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.ciphertext !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredRecord(storage: PasskeyUnlockStorage, record: StoredPasskeyUnlock): void {
  storage.setItem(WEB_PASSKEY_UNLOCK_STORAGE_KEY, JSON.stringify(record));
}

export function clearPasskeyUnlock(storage: PasskeyUnlockStorage): void {
  storage.removeItem?.(WEB_PASSKEY_UNLOCK_STORAGE_KEY);
  if (!storage.removeItem && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(WEB_PASSKEY_UNLOCK_STORAGE_KEY);
  }
}

export function isPasskeyUnlockSupported(): boolean {
  return (
    typeof globalThis.window !== 'undefined' &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof crypto?.subtle?.importKey === 'function' &&
    typeof navigator?.credentials?.create === 'function' &&
    typeof navigator?.credentials?.get === 'function'
  );
}

export function hasStoredPasskeyUnlock(storage: PasskeyUnlockStorage): boolean {
  return readStoredRecord(storage) !== null;
}

function resolveRpId(getRpId?: () => string): string {
  if (getRpId) {
    return getRpId();
  }
  if (typeof window !== 'undefined' && window.location.hostname) {
    return window.location.hostname;
  }
  return 'localhost';
}

async function importPrfAesKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(prfOutput).slice(0, 32);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function wrapKekWithPrfKey(
  prfOutput: ArrayBuffer,
  kek: CryptoKeyRef,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const key = await importPrfAesKey(prfOutput);
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, kekBytes(kek));
  return { iv, ciphertext: new Uint8Array(encrypted) };
}

export async function unwrapKekWithPrfKey(
  prfOutput: ArrayBuffer,
  wrapped: { iv: Uint8Array; ciphertext: Uint8Array },
): Promise<CryptoKeyRef> {
  const key = await importPrfAesKey(prfOutput);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: wrapped.iv },
    key,
    wrapped.ciphertext,
  );
  return wrapKey(new Uint8Array(plaintext));
}

async function evalPasskeyPrf(deps: {
  storage: PasskeyUnlockStorage;
  getRpId?: () => string;
  credentialId: Uint8Array;
  prfSalt: Uint8Array;
}): Promise<ArrayBuffer> {
  const rpId = resolveRpId(deps.getRpId);
  const challenge = randomBytes(32);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId,
      allowCredentials: [{ type: 'public-key', id: deps.credentialId }],
      userVerification: 'required',
      extensions: {
        prf: {
          eval: {
            first: deps.prfSalt,
          },
        },
      },
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error('PASSKEY_CANCELLED');
  }

  const extensions = assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputs;
  const prfOutput = extensions.prf?.results?.first;
  if (!prfOutput) {
    throw new Error('PASSKEY_PRF_UNAVAILABLE');
  }
  return prfOutput;
}

/**
 * Register a platform passkey and persist a PRF-wrapped copy of the KEK.
 */
export async function registerPasskeyUnlock(
  kek: CryptoKeyRef,
  deps: { storage: PasskeyUnlockStorage; getRpId?: () => string },
): Promise<void> {
  if (!isPasskeyUnlockSupported()) {
    throw new Error('PASSKEY_UNSUPPORTED');
  }

  const rpId = resolveRpId(deps.getRpId);
  const userId = randomBytes(32);
  const prfSalt = randomBytes(32);
  const challenge = randomBytes(32);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Complex Patient', id: rpId },
      user: {
        id: userId,
        name: 'vault@complex-patient',
        displayName: 'Complex Patient vault',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      extensions: {
        prf: {
          eval: {
            first: prfSalt,
          },
        },
      },
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('PASSKEY_CANCELLED');
  }

  const extensions = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs;
  const prfOutput = extensions.prf?.results?.first;
  if (!prfOutput) {
    throw new Error('PASSKEY_PRF_UNAVAILABLE');
  }

  const wrapped = await wrapKekWithPrfKey(prfOutput, kek);
  writeStoredRecord(deps.storage, {
    version: 1,
    rpId,
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    prfSalt: bytesToBase64Url(prfSalt),
    iv: bytesToBase64Url(wrapped.iv),
    ciphertext: bytesToBase64Url(wrapped.ciphertext),
  });
}

/**
 * Re-wrap the current KEK after a successful passphrase unlock when a passkey
 * is already registered (e.g. passphrase changed).
 */
export async function refreshPasskeyUnlockWrap(
  kek: CryptoKeyRef,
  deps: { storage: PasskeyUnlockStorage; getRpId?: () => string },
): Promise<void> {
  const stored = readStoredRecord(deps.storage);
  if (!stored) {
    throw new Error('PASSKEY_NOT_REGISTERED');
  }

  const prfOutput = await evalPasskeyPrf({
    storage: deps.storage,
    getRpId: deps.getRpId,
    credentialId: base64UrlToBytes(stored.credentialId),
    prfSalt: base64UrlToBytes(stored.prfSalt),
  });

  const wrapped = await wrapKekWithPrfKey(prfOutput, kek);
  writeStoredRecord(deps.storage, {
    ...stored,
    iv: bytesToBase64Url(wrapped.iv),
    ciphertext: bytesToBase64Url(wrapped.ciphertext),
  });
}

/**
 * Unlock by verifying the passkey and decrypting the wrapped KEK.
 */
export async function unlockKekWithPasskey(deps: {
  storage: PasskeyUnlockStorage;
  getRpId?: () => string;
}): Promise<CryptoKeyRef> {
  const stored = readStoredRecord(deps.storage);
  if (!stored) {
    throw new Error('PASSKEY_NOT_REGISTERED');
  }

  const rpId = resolveRpId(deps.getRpId);
  if (stored.rpId !== rpId) {
    clearPasskeyUnlock(deps.storage);
    throw new Error('PASSKEY_RP_MISMATCH');
  }

  const prfOutput = await evalPasskeyPrf({
    storage: deps.storage,
    getRpId: deps.getRpId,
    credentialId: base64UrlToBytes(stored.credentialId),
    prfSalt: base64UrlToBytes(stored.prfSalt),
  });

  try {
    return await unwrapKekWithPrfKey(prfOutput, {
      iv: base64UrlToBytes(stored.iv),
      ciphertext: base64UrlToBytes(stored.ciphertext),
    });
  } catch {
    clearPasskeyUnlock(deps.storage);
    throw new Error('PASSKEY_DECRYPT_FAILED');
  }
}
