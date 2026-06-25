/**
 * Vault and device settings shared by mobile and web.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WeatherSettingsSection } from './WeatherSettingsSection';
import { ChangePassphraseSection } from './ChangePassphraseSection';
import { PasskeyUnlockSection } from './PasskeyUnlockSection';
import { PaperBackupSection } from './PaperBackupSection';
import type { KdfMaterialStorage } from './kdf-material-storage';

export interface VaultSettingsScreenProps {
  kdfStorage: KdfMaterialStorage;
  /** Show the mobile-only background location trail toggle. */
  showLocationTrailToggle?: boolean;
  /** Optional platform note under weather settings (e.g. native permissions). */
  weatherPlatformNote?: React.ReactNode;
}

export function VaultSettingsScreen({
  kdfStorage,
  showLocationTrailToggle = false,
  weatherPlatformNote,
}: VaultSettingsScreenProps): React.ReactElement {
  return (
    <View style={styles.container} testID="vault-settings-screen">
      <Text style={styles.screenTitle}>Settings</Text>
      <Text style={styles.screenLead}>
        Manage vault security, paper recovery backups, and optional weather/location features on this
        device.
      </Text>

      <View style={styles.sectionGroup}>
        <Text style={styles.sectionGroupTitle}>Security &amp; recovery</Text>
        <ChangePassphraseSection kdfStorage={kdfStorage} />
        <PasskeyUnlockSection />
        <PaperBackupSection kdfStorage={kdfStorage} />
      </View>

      <View style={styles.sectionGroup}>
        <Text style={styles.sectionGroupTitle}>Weather &amp; location</Text>
        <WeatherSettingsSection
          showLocationTrailToggle={showLocationTrailToggle}
          platformNote={weatherPlatformNote}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 20,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  screenLead: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginTop: -8,
  },
  sectionGroup: {
    gap: 16,
    paddingTop: 4,
  },
  sectionGroupTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
