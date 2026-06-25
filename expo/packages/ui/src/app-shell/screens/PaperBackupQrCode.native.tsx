/**
 * Native QR renderer — React Native Image cannot display SVG data URLs.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { generatePaperBackupQrMatrix } from '@complex-patient/crypto-engine';

export interface PaperBackupQrCodeProps {
  backupId: string;
  mnemonic: string;
  size?: number;
  testID?: string;
}

export function PaperBackupQrCode({
  backupId,
  mnemonic,
  size = 180,
  testID = 'paper-backup-qr',
}: PaperBackupQrCodeProps): React.ReactElement {
  const { matrix, side, cellSize } = useMemo(() => {
    const generated = generatePaperBackupQrMatrix(backupId, mnemonic);
    return {
      ...generated,
      cellSize: size / generated.side,
    };
  }, [backupId, mnemonic, size]);

  return (
    <View
      style={[styles.frame, { width: size, height: size }]}
      accessibilityLabel="Paper backup QR code"
      testID={testID}
    >
      {Array.from({ length: side }, (_, y) => (
        <View key={`row-${y}`} style={styles.row}>
          {Array.from({ length: side }, (_, x) => {
            const dark = Boolean(matrix[y * side + x]);
            return (
              <View
                key={`cell-${y}-${x}`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: dark ? '#000' : '#fff',
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
});
