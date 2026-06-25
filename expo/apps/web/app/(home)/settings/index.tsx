/**
 * @complex-patient/web — Vault & device settings
 */

import React, { useCallback } from 'react';
import { Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { VaultSettingsScreen } from '@complex-patient/ui/screens';
import { webFlagStorage } from '../../../src/adapters';

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter();
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <VaultSettingsScreen kdfStorage={webFlagStorage} />
      <Pressable style={styles.backButton} onPress={handleBack} accessibilityRole="button" testID="settings-back">
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 24,
    gap: 16,
  },
  backButton: {
    marginTop: 24,
    padding: 14,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  backButtonText: {
    fontSize: 16,
    color: '#555',
    fontWeight: '500',
  },
});
