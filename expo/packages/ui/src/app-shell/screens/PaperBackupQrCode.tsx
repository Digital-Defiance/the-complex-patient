/**
 * QR code fallback for tests and unsupported platforms.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface PaperBackupQrCodeProps {
  backupId: string;
  mnemonic: string;
  qrDataUrl?: string;
  size?: number;
  testID?: string;
}

export function PaperBackupQrCode({ testID = 'paper-backup-qr' }: PaperBackupQrCodeProps): React.ReactElement {
  return (
    <View style={styles.placeholder} testID={testID}>
      <Text style={styles.text}>QR unavailable</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    width: 180,
    height: 180,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafafa',
  },
  text: {
    fontSize: 12,
    color: '#666',
  },
});
