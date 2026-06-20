/**
 * @complex-patient/ui — UnlockScreen
 *
 * Rendered while the Home_Controller status is `locked`. Presents a passphrase
 * input form that:
 * 1. Validates the 12–128 character length bound BEFORE any derivation (7.8).
 * 2. On valid length: generates a salt (first time) or loads stored KDF
 *    material, derives the KEK via `deriveKEK`, and calls `home.unlockWithKek`.
 * 3. On `ready` result → navigation to the authenticated home screen.
 * 4. On non-ready result (non-biometric) → stays on the unlock screen (7.9).
 *
 * Biometric unlock path (native only — Requirements 7.4, 7.5, 7.9):
 * 5. Calls `home.unlock()` which internally uses BiometricAdapter + SecureStore.
 * 6. On `ready` → navigate to home (AppHost route resolver handles this).
 * 7. On `BIOMETRIC_FAILED` / `BIOMETRIC_LOCKED_OUT` → show passphrase re-entry.
 * 8. On other non-ready → preserve locked state, stay on unlock.
 *
 * The Master_Passphrase and derived KEK are NEVER included in any network
 * request — they are passed only to `deriveKEK` / `unlockWithKek` locally on
 * the device (Requirements 7.7, 14.2).
 *
 * KDF material (salt + params) is persisted in a non-secret location OUTSIDE
 * the vault so it is available before unlock (design → StoredKdfMaterial).
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useAppHost } from '../app-host';
import { deriveKEK, generateSalt, type KdfParams, type CryptoKeyRef } from '@complex-patient/crypto-engine';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum passphrase length for UI validation (Requirement 1.9 / 7.8). */
const PASSPHRASE_MIN = 12;
/** Maximum passphrase length for UI validation (Requirement 7.8). */
const PASSPHRASE_MAX = 128;

/** Storage key for persisted KDF material (non-secret). */
const KDF_MATERIAL_KEY = 'complex-patient.kdf-material';

// ---------------------------------------------------------------------------
// KDF Material Storage interface
// ---------------------------------------------------------------------------

/**
 * Interface for persisting KDF material (salt + params) outside the vault.
 * Both native (expo-secure-store / AsyncStorage) and web (localStorage) satisfy
 * this shape. The stored data is NOT secret — it contains only the salt and the
 * algorithm parameters needed to re-derive the same KEK on subsequent unlocks.
 */
export interface KdfMaterialStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

/** Persisted KDF material structure (non-secret). */
export interface StoredKdfMaterial {
  saltBase64: string;
  params: KdfParams;
}

// ---------------------------------------------------------------------------
// Submit result type
// ---------------------------------------------------------------------------

export type PassphraseSubmitResult =
  | { ok: true }
  | { ok: false; reason: 'LENGTH' | 'DERIVATION_FAILED' | 'STILL_LOCKED' };

// ---------------------------------------------------------------------------
// submitPassphrase — pure logic (testable without React)
// ---------------------------------------------------------------------------

export interface PassphraseScreenDeps {
  home: { unlockWithKek: (kek: CryptoKeyRef) => Promise<{ ok: boolean }> };
  loadKdfMaterial(): Promise<{ salt: Uint8Array; params: KdfParams } | null>;
  saveKdfMaterial(m: { salt: Uint8Array; params: KdfParams }): Promise<void>;
}

/**
 * Core passphrase submission logic. Validates length bound, derives KEK, and
 * calls unlockWithKek. Exported for direct testing (Property 4).
 *
 * Requirements: 7.3, 7.6, 7.8, 7.9
 */
export async function submitPassphrase(
  deps: PassphraseScreenDeps,
  passphrase: string,
): Promise<PassphraseSubmitResult> {
  // Requirement 7.8: enforce 12–128 length bound BEFORE any derivation
  if (passphrase.length < PASSPHRASE_MIN || passphrase.length > PASSPHRASE_MAX) {
    return { ok: false, reason: 'LENGTH' };
  }

  // Load existing KDF material or generate new (first vault creation)
  const material = (await deps.loadKdfMaterial())
    ?? { salt: await generateSalt(), params: { algorithm: 'PBKDF2' as const, pbkdf2Iterations: 600_000 } };

  // Derive KEK through the Crypto_Engine (on-device only)
  const derived = await deriveKEK(passphrase, material.salt, material.params);
  if (!derived.ok) {
    console.error('[Unlock] deriveKEK failed:', derived);
    return { ok: false, reason: 'DERIVATION_FAILED' };
  }

  // Persist the non-secret KDF material outside the vault
  await deps.saveKdfMaterial(material);

  // Attempt to unlock the vault with the derived KEK
  console.log('[Unlock] calling unlockWithKek...');
  const res = await deps.home.unlockWithKek(derived.kek);
  console.log('[Unlock] unlockWithKek result:', JSON.stringify(res));
  return res.ok ? { ok: true } : { ok: false, reason: 'STILL_LOCKED' };
}

// ---------------------------------------------------------------------------
// submitBiometric — biometric unlock path (native only)
// ---------------------------------------------------------------------------

/**
 * Result of a biometric unlock attempt.
 *
 * - `{ ok: true }`: unlocked successfully; navigate to home.
 * - `'FALLBACK'`: biometric failed or locked out; show passphrase re-entry (7.5).
 * - `{ ok: false; reason: 'STILL_LOCKED' }`: other non-ready; stay on unlock (7.9).
 */
export type BiometricSubmitResult =
  | { ok: true }
  | { ok: false; reason: 'STILL_LOCKED' }
  | 'FALLBACK';

/**
 * Biometric unlock path (native only). Calls `home.unlock()` which internally
 * uses the BiometricAdapter + SecureStore to retrieve and decrypt the KEK.
 *
 * On success (`ready`) → returns `{ ok: true }` (caller navigates to home).
 * On `BIOMETRIC_FAILED` / `BIOMETRIC_LOCKED_OUT` → returns `'FALLBACK'`
 *   (caller presents the passphrase re-entry path and stays on unlock — Req 7.5).
 * On other non-ready → returns `{ ok: false, reason: 'STILL_LOCKED' }`
 *   (caller preserves locked state and stays on unlock — Req 7.9).
 *
 * Requirements: 7.4, 7.5, 7.9
 */
export async function submitBiometric(
  home: { unlock(): Promise<{ ok: boolean; reason?: string }> },
): Promise<BiometricSubmitResult> {
  const res = await home.unlock();
  if (res.ok) return { ok: true };
  // No stored KEK yet, biometric failure, or session lockout → passphrase path (7.5).
  if (
    res.reason === 'NO_KEY_STORED' ||
    res.reason === 'BIOMETRIC_FAILED' ||
    res.reason === 'BIOMETRIC_LOCKED_OUT'
  ) {
    return 'FALLBACK';
  }
  // Other non-ready → preserve locked state, stay on unlock screen (7.9).
  return { ok: false, reason: 'STILL_LOCKED' };
}

// ---------------------------------------------------------------------------
// KDF material helpers
// ---------------------------------------------------------------------------

/**
 * Create load/save functions for KDF material backed by a key-value storage.
 * The storage is outside the vault (non-secret location), suitable for
 * expo-secure-store or localStorage.
 */
export function createKdfMaterialStorage(storage: KdfMaterialStorage) {
  return {
    async loadKdfMaterial(): Promise<{ salt: Uint8Array; params: KdfParams } | null> {
      const raw = await storage.getItem(KDF_MATERIAL_KEY);
      if (!raw) return null;
      try {
        const parsed: StoredKdfMaterial = JSON.parse(raw);
        const salt = bytesFromBase64(parsed.saltBase64);
        return { salt, params: parsed.params };
      } catch {
        return null;
      }
    },
    async saveKdfMaterial(m: { salt: Uint8Array; params: KdfParams }): Promise<void> {
      const stored: StoredKdfMaterial = {
        saltBase64: base64FromBytes(m.salt),
        params: m.params,
      };
      await storage.setItem(KDF_MATERIAL_KEY, JSON.stringify(stored));
    },
  };
}

// ---------------------------------------------------------------------------
// UnlockScreen component
// ---------------------------------------------------------------------------

export interface UnlockScreenProps {
  /** Non-secret KDF material storage (outside the vault). */
  kdfStorage: KdfMaterialStorage;
  /**
   * Whether biometric unlock is available on this device. When true, the screen
   * shows a biometric unlock button alongside the passphrase input. On web or
   * when no biometrics are enrolled, this should be false.
   */
  biometricAvailable?: boolean;
}

export function UnlockScreen({ kdfStorage, biometricAvailable = false }: UnlockScreenProps): React.ReactElement {
  const { home, refreshHomeStatus } = useAppHost();

  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  /**
   * Whether to show the passphrase input form. Initially hidden when biometric
   * is available (the user can attempt biometric first). Set to true on
   * BIOMETRIC_FAILED / BIOMETRIC_LOCKED_OUT fallback (Requirement 7.5).
   */
  const [showPassphraseInput, setShowPassphraseInput] = useState(!biometricAvailable);

  const handleSubmit = useCallback(async () => {
    if (!home) return;

    setError(null);
    setLoading(true);
    setLoadingMessage('Deriving encryption key… This can take up to a minute.');

    const { loadKdfMaterial, saveKdfMaterial } = createKdfMaterialStorage(kdfStorage);

    try {
      const result = await submitPassphrase(
        { home, loadKdfMaterial, saveKdfMaterial },
        passphrase,
      );

      if (result.ok) {
        refreshHomeStatus();
        return;
      }

      switch (result.reason) {
        case 'LENGTH':
          setError('Passphrase must be between 12 and 128 characters.');
          break;
        case 'DERIVATION_FAILED':
          setError('Unable to derive key. Please try again.');
          break;
        case 'STILL_LOCKED':
          setError('Unlock failed. Please check your passphrase and try again.');
          break;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unlock failed unexpectedly.';
      setError(message);
    } finally {
      setLoading(false);
      setLoadingMessage(null);
    }
  }, [home, passphrase, kdfStorage, refreshHomeStatus]);

  /**
   * Attempt biometric unlock. On success the AppHost route resolver navigates
   * to home automatically. On BIOMETRIC_FAILED / BIOMETRIC_LOCKED_OUT, show the
   * passphrase re-entry path (Requirement 7.5). On other non-ready, stay locked.
   *
   * Requirements: 7.4, 7.5, 7.9
   */
  const handleBiometric = useCallback(async () => {
    if (!home) return;

    setError(null);
    setLoading(true);
    setLoadingMessage('Unlocking…');

    try {
      const result = await submitBiometric(home);

      if (result === 'FALLBACK') {
        setShowPassphraseInput(true);
        setError('Please enter your master passphrase to unlock.');
        return;
      }

      if (result.ok) {
        refreshHomeStatus();
        return;
      }

      setError('Unlock failed. Please try again.');
    } finally {
      setLoading(false);
      setLoadingMessage(null);
    }
  }, [home, refreshHomeStatus]);

  return (
    <View
      style={styles.container}
      accessibilityRole="none"
      accessibilityLabel="Unlock vault"
    >
      <Text style={styles.title}>Unlock Your Vault</Text>
      <Text style={styles.subtitle}>
        {showPassphraseInput
          ? 'Enter your Master Passphrase to decrypt your data.'
          : 'Use biometrics to unlock your vault.'}
      </Text>

      {error && (
        <Text style={styles.error} accessibilityRole="alert" testID="unlock-error">
          {error}
        </Text>
      )}

      {loadingMessage && (
        <Text style={styles.loadingMessage} testID="unlock-loading-message">
          {loadingMessage}
        </Text>
      )}

      {/* Biometric unlock button — shown when biometric is available */}
      {biometricAvailable && !showPassphraseInput && (
        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleBiometric}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Unlock with biometrics"
          testID="unlock-biometric"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Unlock with Biometrics</Text>
          )}
        </Pressable>
      )}

      {/* Passphrase re-entry path — shown initially (no biometric) or on fallback */}
      {showPassphraseInput && (
        <>
          <TextInput
            style={styles.input}
            placeholder="Master Passphrase"
            value={passphrase}
            onChangeText={setPassphrase}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            accessibilityLabel="Master Passphrase"
            testID="unlock-passphrase"
          />

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Unlock"
            testID="unlock-submit"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Unlock</Text>
            )}
          </Pressable>
        </>
      )}

      {/* Link to switch to passphrase entry when biometric is showing */}
      {biometricAvailable && !showPassphraseInput && (
        <Pressable
          style={styles.linkButton}
          onPress={() => setShowPassphraseInput(true)}
          accessibilityRole="button"
          accessibilityLabel="Use passphrase instead"
          testID="unlock-use-passphrase"
        >
          <Text style={styles.linkText}>Use passphrase instead</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Portable Base64 helpers (same as in adapters.ts — no Buffer/btoa dependency)
// ---------------------------------------------------------------------------

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
  error: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  loadingMessage: {
    color: '#555',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
    maxWidth: 320,
  },
  input: {
    width: '100%',
    maxWidth: 320,
    height: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  button: {
    width: '100%',
    maxWidth: 320,
    height: 48,
    backgroundColor: '#0066cc',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 16,
    padding: 8,
  },
  linkText: {
    color: '#0066cc',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
