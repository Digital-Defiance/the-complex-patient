/**
 * Web-only passkey fast-unlock management while the vault is unlocked.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useAppHost } from '../app-host';

export function PasskeyUnlockSection(): React.ReactElement | null {
  const { home } = useAppHost();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const passkeySupported = home?.isPasskeyUnlockAvailable?.() ?? false;
  const passkeyActive = home?.hasPasskeyUnlock?.() ?? false;

  const handleSave = useCallback(
    async (replace: boolean) => {
      if (!home?.enablePasskeyUnlock) {
        setErrorMessage('Passkey unlock is not available in this app build.');
        return;
      }

      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const result = await home.enablePasskeyUnlock({ replace });
        if (result.ok) {
          setStatusMessage(
            replace
              ? 'New passkey saved. Use it next time you return to this browser.'
              : 'Passkey saved. Use it next time you return to this browser.',
          );
          return;
        }
        setErrorMessage(result.message);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Passkey setup failed.';
        setErrorMessage(message);
      } finally {
        setLoading(false);
      }
    },
    [home],
  );

  const handleRemove = useCallback(() => {
    if (!home?.removePasskeyUnlock) {
      setErrorMessage('Passkey unlock is not available in this app build.');
      return;
    }

    Alert.alert(
      'Remove passkey unlock?',
      'You will need your master passphrase each time you return to this browser until you save a new passkey.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            home.removePasskeyUnlock?.();
            setStatusMessage('Passkey removed from this browser.');
            setErrorMessage(null);
          },
        },
      ],
    );
  }, [home]);

  if (!passkeySupported) {
    return null;
  }

  if (!home || home.getStatus() !== 'ready') {
    return (
      <View style={styles.container} testID="passkey-unlock-locked">
        <Text style={styles.title}>Passkey unlock</Text>
        <Text style={styles.note}>
          Unlock your vault to save or replace the passkey used for fast unlock on this browser.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="passkey-unlock-section">
      <Text style={styles.title}>Passkey unlock</Text>
      <Text style={styles.lead}>
        Save a device passkey to skip slow key derivation when you return to this browser. Your master
        passphrase is still required if passkey unlock fails.
      </Text>

      <Text style={styles.status} testID="passkey-unlock-status">
        {passkeyActive ? 'Passkey is saved on this browser.' : 'No passkey saved on this browser yet.'}
      </Text>

      {statusMessage && (
        <Text style={styles.success} accessibilityRole="alert" testID="passkey-unlock-success">
          {statusMessage}
        </Text>
      )}
      {errorMessage && (
        <Text style={styles.error} accessibilityRole="alert" testID="passkey-unlock-error">
          {errorMessage}
        </Text>
      )}

      <View style={styles.actions}>
        {!passkeyActive && (
          <Pressable
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={() => void handleSave(false)}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Save passkey for faster unlock"
            testID="passkey-unlock-save"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save passkey</Text>
            )}
          </Pressable>
        )}

        {passkeyActive && (
          <>
            <Pressable
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={() => void handleSave(true)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Replace passkey on this browser"
              testID="passkey-unlock-replace"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Replace passkey</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, loading && styles.buttonDisabled]}
              onPress={handleRemove}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Remove passkey from this browser"
              testID="passkey-unlock-remove"
            >
              <Text style={styles.secondaryButtonText}>Remove passkey</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  lead: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  note: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  success: {
    fontSize: 14,
    color: '#0a6b2d',
    lineHeight: 20,
  },
  error: {
    fontSize: 14,
    color: '#b00020',
    lineHeight: 20,
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#0066cc',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
