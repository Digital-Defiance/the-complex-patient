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

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
} from 'react-native';
import { PASSKEY_SETUP_SESSION_KEY } from '@complex-patient/key-store';
import { useAppHost } from '../app-host';
import {
  IosKeyboardDoneAccessory,
  keyboardDoneAccessoryProps,
} from '../ios-keyboard-done-accessory';
import { deriveKEK, type KdfParams, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import { resolveKdfMaterialForUnlock, KdfMaterialMissingError } from '../../app/kdf-material-sync';
import { PaperBackupRecoveryPanel } from './PaperBackupRecoveryPanel';
import {
  createKdfMaterialStorage,
  type KdfMaterialStorage,
  type StoredKdfMaterial,
} from './kdf-material-storage';

export type { KdfMaterialStorage, StoredKdfMaterial };
export { createKdfMaterialStorage };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum passphrase length for UI validation (Requirement 1.9 / 7.8). */
const PASSPHRASE_MIN = 12;
/** Maximum passphrase length for UI validation (Requirement 7.8). */
const PASSPHRASE_MAX = 128;

// ---------------------------------------------------------------------------
// Submit result type
// ---------------------------------------------------------------------------

export type PassphraseSubmitResult =
  | { ok: true; quarantinedPartitions?: string[] }
  | {
      ok: false;
      reason:
        | 'LENGTH'
        | 'DERIVATION_FAILED'
        | 'STILL_LOCKED'
        | 'KDF_MISSING'
        | 'NOT_AUTHENTICATED'
        | 'CORRUPT_PARTITION';
      partition?: string;
    };

export interface PassphraseSubmitOptions {
  /** Quarantine these partitions before unlock (explicit user consent). */
  quarantinePartitions?: string[];
}

// ---------------------------------------------------------------------------
// submitPassphrase — pure logic (testable without React)
// ---------------------------------------------------------------------------

export interface PassphraseScreenDeps {
  home: {
    unlockWithKek: (
      kek: CryptoKeyRef,
      options?: { quarantinePartitions?: string[] },
    ) => Promise<{ ok: boolean; reason?: string; partition?: string; quarantinedPartitions?: string[] }>;
    fetchRemoteKdfMaterial?: () => Promise<{ salt: Uint8Array; params: KdfParams } | null>;
    publishKdfMaterial?: (material: { salt: Uint8Array; params: KdfParams }) => Promise<void>;
    probeRemoteVaultDecrypt?: (kek: CryptoKeyRef) => Promise<boolean>;
    hasExistingVaultData?: () => Promise<boolean>;
  };
  loadKdfMaterial(): Promise<{ salt: Uint8Array; params: KdfParams } | null>;
  saveKdfMaterial(m: { salt: Uint8Array; params: KdfParams }): Promise<void>;
  hasExistingVaultData?: () => Promise<boolean>;
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
  options?: PassphraseSubmitOptions,
): Promise<PassphraseSubmitResult> {
  // Requirement 7.8: enforce 12–128 length bound BEFORE any derivation
  if (passphrase.length < PASSPHRASE_MIN || passphrase.length > PASSPHRASE_MAX) {
    return { ok: false, reason: 'LENGTH' };
  }

  // Resolve shared KDF material (local + Sync_Backend) before deriving the KEK.
  let material;
  try {
    material = await resolveKdfMaterialForUnlock({
      passphrase,
      loadLocal: deps.loadKdfMaterial,
      saveLocal: deps.saveKdfMaterial,
      fetchRemote: deps.home.fetchRemoteKdfMaterial,
      publishRemote: deps.home.publishKdfMaterial,
      hasExistingVaultData: deps.home.hasExistingVaultData ?? deps.hasExistingVaultData,
      verifyKekAgainstRemote: deps.home.probeRemoteVaultDecrypt,
    });
  } catch (error) {
    if (error instanceof KdfMaterialMissingError) {
      return { ok: false, reason: 'KDF_MISSING' };
    }
    throw error;
  }

  // Derive KEK through the Crypto_Engine (on-device only)
  const derived = await deriveKEK(passphrase, material.salt, material.params);
  if (!derived.ok) {
    console.error('[Unlock] deriveKEK failed:', derived);
    return { ok: false, reason: 'DERIVATION_FAILED' };
  }

  // Attempt to unlock the vault with the derived KEK
  console.log('[Unlock] calling unlockWithKek...');
  const res = await deps.home.unlockWithKek(derived.kek, {
    quarantinePartitions: options?.quarantinePartitions,
  });
  console.log('[Unlock] unlockWithKek result:', JSON.stringify(res));
  if (res.ok) {
    return {
      ok: true,
      quarantinedPartitions: res.quarantinedPartitions,
    };
  }
  if (res.reason === 'NOT_AUTHENTICATED') {
    return { ok: false, reason: 'NOT_AUTHENTICATED' };
  }
  if (res.reason === 'CORRUPT_PARTITION' && res.partition) {
    return { ok: false, reason: 'CORRUPT_PARTITION', partition: res.partition };
  }
  return { ok: false, reason: 'STILL_LOCKED' };
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
  // No stored KEK yet, biometric failure, session lockout, or broken passkey → passphrase path (7.5).
  if (
    res.reason === 'NO_KEY_STORED' ||
    res.reason === 'BIOMETRIC_FAILED' ||
    res.reason === 'BIOMETRIC_LOCKED_OUT' ||
    res.reason === 'PASSPHRASE_REQUIRED'
  ) {
    return 'FALLBACK';
  }
  // Other non-ready → preserve locked state, stay on unlock screen (7.9).
  return { ok: false, reason: 'STILL_LOCKED' };
}

/** Shown when the device supports biometrics — sets expectation after a slow passphrase unlock. */
export const BIOMETRIC_FUTURE_UNLOCK_HINT =
  'After you unlock with your passphrase once, future unlocks can use biometrics and are much faster.';

/** Shown on the biometric-first path before a stored unlock key exists. */
export const BIOMETRIC_FAST_PATH_HINT =
  'Use biometrics for quick access. First-time setup still requires your master passphrase.';

/** Shown when passkey unlock is available on web. */
export const PASSKEY_FAST_PATH_HINT =
  'Use your device passkey for quick access. Your master passphrase is still required the first time on this browser.';

/** Shown on the passphrase path when passkey setup is offered. */
export const PASSKEY_SETUP_HINT =
  'After unlock, save a passkey on the home screen to skip slow key derivation when you return to this browser.';

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
  /**
   * Whether passkey unlock is configured on this browser. When true, the screen
   * shows a passkey unlock button before the passphrase form.
   */
  passkeyAvailable?: boolean;
  /** Show a checkbox to register passkey unlock after a passphrase unlock. */
  offerPasskeySetup?: boolean;
  /** Optional signal that encrypted vault data already exists on this device. */
  hasExistingVaultData?: () => Promise<boolean>;
}

export function UnlockScreen({
  kdfStorage,
  biometricAvailable = false,
  passkeyAvailable: passkeyAvailableProp = false,
  offerPasskeySetup: offerPasskeySetupProp = false,
  hasExistingVaultData,
}: UnlockScreenProps): React.ReactElement {
  const { home, refreshHomeStatus } = useAppHost();

  const passkeySupported = home?.isPasskeyUnlockAvailable?.() ?? false;
  const [hasPasskey, setHasPasskey] = useState(
    () => home?.hasPasskeyUnlock?.() ?? passkeyAvailableProp,
  );

  useEffect(() => {
    const refreshPasskeyState = () => {
      if (home?.hasPasskeyUnlock) {
        setHasPasskey(home.hasPasskeyUnlock());
        return;
      }
      setHasPasskey(passkeyAvailableProp);
    };

    refreshPasskeyState();

    if (Platform.OS !== 'web') {
      return undefined;
    }

    const win = globalThis.window;
    if (
      typeof win?.addEventListener !== 'function' ||
      typeof win.document?.addEventListener !== 'function'
    ) {
      return undefined;
    }

    win.addEventListener('focus', refreshPasskeyState);
    win.document.addEventListener('visibilitychange', refreshPasskeyState);
    return () => {
      win.removeEventListener('focus', refreshPasskeyState);
      win.document.removeEventListener('visibilitychange', refreshPasskeyState);
    };
  }, [home, passkeyAvailableProp]);

  const passkeyAvailable = passkeySupported && hasPasskey;
  const offerPasskeySetup = passkeySupported && !hasPasskey;
  const quickUnlockAvailable = biometricAvailable || passkeyAvailable;

  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [showPassphraseInput, setShowPassphraseInput] = useState(!quickUnlockAvailable);
  const [hasStoredUnlockKey, setHasStoredUnlockKey] = useState(false);
  const [preferPassphrase, setPreferPassphrase] = useState(false);
  const [enablePasskeyAfterUnlock, setEnablePasskeyAfterUnlock] = useState(true);
  const [corruptPartitionOffer, setCorruptPartitionOffer] = useState<string | null>(null);

  useEffect(() => {
    if (passkeyAvailable && !preferPassphrase) {
      setShowPassphraseInput(false);
    }
  }, [passkeyAvailable, preferPassphrase]);

  useEffect(() => {
    if (!home || !biometricAvailable || preferPassphrase) {
      setHasStoredUnlockKey(false);
      return;
    }

    let cancelled = false;
    void home.hasStoredUnlockKey().then((stored) => {
      if (cancelled) {
        return;
      }
      setHasStoredUnlockKey(stored);
      if (stored) {
        setShowPassphraseInput(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [home, biometricAvailable, preferPassphrase]);

  const queuePasskeySetupOffer = useCallback(() => {
    if (!enablePasskeyAfterUnlock || !offerPasskeySetup) {
      return;
    }
    const storage =
      typeof globalThis.sessionStorage !== 'undefined' ? globalThis.sessionStorage : null;
    if (storage) {
      storage.setItem(PASSKEY_SETUP_SESSION_KEY, '1');
    }
  }, [enablePasskeyAfterUnlock, offerPasskeySetup]);

  const handleSubmit = useCallback(async () => {
    if (!home) return;

    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    setLoadingMessage('Deriving encryption key… This can take a minute or so.');

    const { loadKdfMaterial, saveKdfMaterial } = createKdfMaterialStorage(kdfStorage);

    try {
      const result = await submitPassphrase(
        {
          home,
          loadKdfMaterial,
          saveKdfMaterial,
          hasExistingVaultData,
        },
        passphrase,
      );

      if (result.ok) {
        setCorruptPartitionOffer(null);
        if (result.quarantinedPartitions && result.quarantinedPartitions.length > 0) {
          Alert.alert(
            'Some vault data was quarantined',
            `Undecryptable data was moved to a local encrypted backup for: ${result.quarantinedPartitions.join(', ')}. Those records will appear empty until recovered. This is not normal — contact support if you did not expect this.`,
            [{ text: 'Continue', onPress: () => refreshHomeStatus() }],
          );
          return;
        }
        queuePasskeySetupOffer();
        if (Platform.OS !== 'web' && biometricAvailable) {
          void home.hasStoredUnlockKey().then((stored) => {
            if (stored) {
              Alert.alert(
                'Biometric unlock ready',
                'Next time, use Unlock with Biometrics instead of re-entering your master passphrase.',
              );
            }
          });
        }
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
        case 'CORRUPT_PARTITION':
          setCorruptPartitionOffer(result.partition ?? null);
          setError(
            `Your ${result.partition ?? 'vault'} data on this device could not be decrypted. This is not normal. You can try again after the app restores from the server, or continue with empty ${result.partition ?? 'data'} (encrypted backup quarantined on this device only).`,
          );
          break;
        case 'STILL_LOCKED':
          setCorruptPartitionOffer(null);
          setError(
            'Unlock failed. Your passphrase may be wrong, or a synced vault copy on the server does not match this device. Try again in a moment — the app will attempt to restore compatible server data automatically.',
          );
          break;
        case 'KDF_MISSING':
          setError(
            'Vault data is on this device but key-derivation settings are missing. Use Recover with paper backup below, or restore from another device.',
          );
          break;
        case 'NOT_AUTHENTICATED':
          setError('Session expired. Sign in again, then unlock.');
          break;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unlock failed unexpectedly.';
      setError(message);
    } finally {
      setLoading(false);
      setLoadingMessage(null);
    }
  }, [hasExistingVaultData, home, kdfStorage, queuePasskeySetupOffer, passphrase, refreshHomeStatus]);

  const handleQuarantineAndUnlock = useCallback(async () => {
    if (!home || !corruptPartitionOffer) return;

    setError(null);
    setLoading(true);
    setLoadingMessage('Quarantining undecryptable backup and unlocking…');

    const { loadKdfMaterial, saveKdfMaterial } = createKdfMaterialStorage(kdfStorage);

    try {
      const result = await submitPassphrase(
        {
          home,
          loadKdfMaterial,
          saveKdfMaterial,
          hasExistingVaultData,
        },
        passphrase,
        { quarantinePartitions: [corruptPartitionOffer] },
      );

      if (result.ok) {
        setCorruptPartitionOffer(null);
        queuePasskeySetupOffer();
        if (result.quarantinedPartitions && result.quarantinedPartitions.length > 0) {
          Alert.alert(
            'Vault unlocked with quarantined data',
            `${result.quarantinedPartitions.join(', ')} was moved to a local encrypted backup and will appear empty. This is not normal.`,
            [{ text: 'Continue', onPress: () => refreshHomeStatus() }],
          );
          return;
        }
        refreshHomeStatus();
        return;
      }

      setError('Could not unlock after quarantine. Try again or contact support.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unlock failed unexpectedly.';
      setError(message);
    } finally {
      setLoading(false);
      setLoadingMessage(null);
    }
  }, [corruptPartitionOffer, hasExistingVaultData, home, kdfStorage, queuePasskeySetupOffer, passphrase, refreshHomeStatus]);

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
        if (passkeyAvailable) {
          setHasPasskey(home.hasPasskeyUnlock?.() ?? false);
          setError(
            'Passkey unlock failed. Enter your master passphrase, or reset your passkey if it no longer works.',
          );
        } else {
          setError('Please enter your master passphrase to unlock.');
        }
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
  }, [home, passkeyAvailable, refreshHomeStatus]);

  const handleResetPasskey = useCallback(() => {
    home?.removePasskeyUnlock?.();
    setHasPasskey(false);
    setPreferPassphrase(true);
    setShowPassphraseInput(true);
    setError(
      'Saved passkey removed from this browser. Unlock with your master passphrase, then set up a new passkey in Settings.',
    );
  }, [home]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      accessibilityRole="none"
      accessibilityLabel="Unlock vault"
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        testID="unlock-screen"
      >
        <View style={styles.form}>
          <IosKeyboardDoneAccessory />

      <Text style={styles.title}>Unlock Your Vault</Text>
      <Text style={styles.subtitle}>
        {showPassphraseInput
          ? 'Enter your Master Passphrase to decrypt your data.'
          : passkeyAvailable
            ? 'Use your passkey to unlock your vault.'
            : 'Use biometrics to unlock your vault.'}
      </Text>

      {quickUnlockAvailable && !showPassphraseInput && (
        <Text style={styles.hint} testID="unlock-quick-path-hint">
          {passkeyAvailable ? PASSKEY_FAST_PATH_HINT : BIOMETRIC_FAST_PATH_HINT}
        </Text>
      )}

      {offerPasskeySetup && showPassphraseInput && (
        <Text style={styles.hint} testID="unlock-passkey-setup-hint">
          {PASSKEY_SETUP_HINT}
        </Text>
      )}

      {biometricAvailable && showPassphraseInput && !offerPasskeySetup && (
        <Text style={styles.hint} testID="unlock-biometric-future-hint">
          {BIOMETRIC_FUTURE_UNLOCK_HINT}
        </Text>
      )}

      {error && (
        <Text style={styles.error} accessibilityRole="alert" testID="unlock-error">
          {error}
        </Text>
      )}

      {corruptPartitionOffer && showPassphraseInput && (
        <Pressable
          style={[styles.secondaryButton, loading && styles.buttonDisabled]}
          onPress={handleQuarantineAndUnlock}
          disabled={loading}
          accessibilityRole="button"
          testID="unlock-quarantine-partition"
        >
          <Text style={styles.secondaryButtonText}>
            Continue with empty {corruptPartitionOffer} (keep encrypted backup)
          </Text>
        </Pressable>
      )}

      {loadingMessage && (
        <Text style={styles.loadingMessage} testID="unlock-loading-message">
          {loadingMessage}
        </Text>
      )}

      {/* Quick unlock — biometrics (native) or passkey (web) */}
      {quickUnlockAvailable && !showPassphraseInput && (
        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleBiometric}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={passkeyAvailable ? 'Unlock with passkey' : 'Unlock with biometrics'}
          testID={passkeyAvailable ? 'unlock-passkey' : 'unlock-biometric'}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {passkeyAvailable ? 'Unlock with Passkey' : 'Unlock with Biometrics'}
            </Text>
          )}
        </Pressable>
      )}

      {/* Passphrase re-entry path — shown initially (no quick unlock) or on fallback */}
      {showPassphraseInput && (
        <>
          {hasStoredUnlockKey && biometricAvailable && (
            <Pressable
              style={[styles.secondaryButton, loading && styles.buttonDisabled]}
              onPress={handleBiometric}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Unlock with biometrics"
              testID="unlock-biometric-inline"
            >
              {loading ? (
                <ActivityIndicator color="#0066cc" />
              ) : (
                <Text style={styles.secondaryButtonText}>Unlock with Biometrics</Text>
              )}
            </Pressable>
          )}

          {offerPasskeySetup && (
            <Pressable
              style={styles.checkboxRow}
              onPress={() => setEnablePasskeyAfterUnlock((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: enablePasskeyAfterUnlock }}
              testID="unlock-passkey-setup-checkbox"
            >
              <View style={[styles.checkbox, enablePasskeyAfterUnlock && styles.checkboxChecked]} />
              <Text style={styles.checkboxLabel}>
                Set up passkey unlock on the home screen after unlock
              </Text>
            </Pressable>
          )}

          <TextInput
            style={styles.input}
            placeholder="Master Passphrase"
            value={passphrase}
            onChangeText={setPassphrase}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            returnKeyType="done"
            onSubmitEditing={() => {
              void handleSubmit();
            }}
            accessibilityLabel="Master Passphrase"
            testID="unlock-passphrase"
            {...keyboardDoneAccessoryProps()}
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

      {/* Link to switch to passphrase entry when quick unlock is showing */}
      {quickUnlockAvailable && !showPassphraseInput && (
        <Pressable
          style={styles.linkButton}
          onPress={() => {
            setPreferPassphrase(true);
            setShowPassphraseInput(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Use passphrase instead"
          testID="unlock-use-passphrase"
        >
          <Text style={styles.linkText}>Use passphrase instead</Text>
        </Pressable>
      )}

      {passkeySupported && (passkeyAvailable || hasPasskey) && (
        <Pressable
          style={styles.linkButton}
          onPress={handleResetPasskey}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Reset passkey on this browser"
          testID="unlock-reset-passkey"
        >
          <Text style={styles.linkText}>Reset passkey on this browser</Text>
        </Pressable>
      )}

      {home && (
        <PaperBackupRecoveryPanel
          home={home}
          kdfStorage={kdfStorage}
          onRecovered={refreshHomeStatus}
        />
      )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 32,
    paddingBottom: 48,
  },
  form: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'stretch',
  },
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
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 12,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 20,
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
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  secondaryButton: {
    width: '100%',
    maxWidth: 320,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#c62828',
    borderRadius: 8,
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: '#8a1f1f',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 20,
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
    width: '100%',
    maxWidth: 360,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#0066cc',
    borderRadius: 4,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#0066cc',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
  },
});
