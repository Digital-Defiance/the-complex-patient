/**
 * QR scanner fallback (tests and unsupported platforms).
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

export interface PaperBackupQrScannerProps {
  onScan: (payload: string) => void;
  onClose: () => void;
}

export function PaperBackupQrScanner({ onClose }: PaperBackupQrScannerProps): React.ReactElement {
  return (
    <View style={styles.container} testID="paper-backup-qr-scanner-fallback">
      <Text style={styles.message}>Camera QR scanning is not available here. Paste the scanned text instead.</Text>
      <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
        <Text style={styles.buttonText}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fafafa',
  },
  message: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  buttonText: {
    color: '#333',
    fontWeight: '600',
  },
});
