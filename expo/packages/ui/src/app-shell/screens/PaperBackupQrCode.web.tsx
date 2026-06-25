/**
 * Web QR renderer — SVG data URLs work in RN Web Image.
 */

import React from 'react';
import { Image, StyleSheet } from 'react-native';

export interface PaperBackupQrCodeProps {
  backupId: string;
  mnemonic: string;
  qrDataUrl: string;
  size?: number;
  testID?: string;
}

export function PaperBackupQrCode({
  qrDataUrl,
  size = 180,
  testID = 'paper-backup-qr',
}: PaperBackupQrCodeProps): React.ReactElement {
  return (
    <Image
      source={{ uri: qrDataUrl }}
      style={[styles.qrImage, { width: size, height: size }]}
      accessibilityLabel="Paper backup QR code"
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  qrImage: {
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
});
