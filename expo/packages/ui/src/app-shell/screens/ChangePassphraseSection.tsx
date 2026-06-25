/**
 * Change master passphrase while unlocked, re-wrapping paper backups automatically.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAppHost } from '../app-host';
import { createKdfMaterialStorage, type KdfMaterialStorage } from './kdf-material-storage';

const PASSPHRASE_MIN = 12;
const PASSPHRASE_MAX = 128;

export interface ChangePassphraseSectionProps {
  kdfStorage: KdfMaterialStorage;
}

export function ChangePassphraseSection({
  kdfStorage,
}: ChangePassphraseSectionProps): React.ReactElement {
  const { home } = useAppHost();
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!home) return;

    if (newPassphrase.length < PASSPHRASE_MIN || newPassphrase.length > PASSPHRASE_MAX) {
      Alert.alert('Invalid passphrase', `Use between ${PASSPHRASE_MIN} and ${PASSPHRASE_MAX} characters.`);
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      Alert.alert('Passphrases do not match', 'Confirm your new passphrase.');
      return;
    }

    const { loadKdfMaterial, saveKdfMaterial } = createKdfMaterialStorage(kdfStorage);
    const currentMaterial = await loadKdfMaterial();
    if (!currentMaterial) {
      Alert.alert('Cannot change passphrase', 'Key-derivation settings are missing on this device.');
      return;
    }

    setLoading(true);
    try {
      const result = await home.changeMasterPassphrase(newPassphrase, currentMaterial, saveKdfMaterial);
      if (!result.ok) {
        const message =
          result.reason === 'REWRAP_FAILED'
            ? 'Vault passphrase changed locally but paper backups could not be re-wrapped. Create new backups.'
            : 'Could not change passphrase. Try again while unlocked.';
        Alert.alert('Passphrase change failed', message);
        return;
      }

      setNewPassphrase('');
      setConfirmPassphrase('');
      Alert.alert(
        'Passphrase updated',
        result.rewrappedBackups > 0
          ? `Your vault was re-encrypted and ${result.rewrappedBackups} paper backup(s) were updated.`
          : 'Your vault was re-encrypted. Existing paper backups on this device were updated when registered here.',
      );
    } finally {
      setLoading(false);
    }
  }, [confirmPassphrase, home, kdfStorage, newPassphrase]);

  if (!home || home.getStatus() !== 'ready') {
    return (
      <View style={styles.container} testID="change-passphrase-locked">
        <Text style={styles.note}>Unlock your vault to change your master passphrase.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="change-passphrase-section">
      <Text style={styles.title}>Change master passphrase</Text>
      <Text style={styles.description}>
        This re-encrypts your vault on this device, publishes new key-derivation settings, and
        re-wraps paper backups created on this device. You will need the new passphrase next time you
        unlock without a paper backup.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="New master passphrase"
        value={newPassphrase}
        onChangeText={setNewPassphrase}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
        testID="change-passphrase-new"
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new passphrase"
        value={confirmPassphrase}
        onChangeText={setConfirmPassphrase}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
        testID="change-passphrase-confirm"
      />

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={() => void handleSubmit()}
        disabled={loading}
        accessibilityRole="button"
        testID="change-passphrase-submit"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Change passphrase</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  description: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  note: {
    fontSize: 14,
    color: '#666',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  button: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
