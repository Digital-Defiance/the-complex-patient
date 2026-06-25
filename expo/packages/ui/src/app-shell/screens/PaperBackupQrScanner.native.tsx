/**
 * Native camera QR scanner for paper backup recovery.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { decodePaperBackupQrPayload } from '@complex-patient/crypto-engine';
import type { PaperBackupQrScannerProps } from './PaperBackupQrScanner';

export function PaperBackupQrScanner({ onScan, onClose }: PaperBackupQrScannerProps): React.ReactElement {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const handleBarcode = useCallback(
    (result: { data?: string }) => {
      if (locked || !result.data) {
        return;
      }

      const decoded = decodePaperBackupQrPayload(result.data);
      if (!decoded) {
        setError('QR code is not a valid paper backup. Try another sheet.');
        return;
      }

      setLocked(true);
      onScan(result.data.trim());
      onClose();
    },
    [locked, onClose, onScan],
  );

  const requestAccess = useCallback(async () => {
    setError(null);
    const response = await requestPermission();
    if (!response.granted) {
      setError('Camera access is required to scan your paper backup QR code.');
    }
  }, [requestPermission]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} testID="paper-backup-qr-scanner-modal">
      <View style={styles.container}>
        <Text style={styles.title}>Scan paper backup QR</Text>
        <Text style={styles.hint}>Center the QR code from your printed sheet in the frame.</Text>

        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            {permission === null ? (
              <ActivityIndicator accessibilityLabel="Checking camera permission" />
            ) : (
              <>
                <Text style={styles.permissionText}>
                  Allow camera access to scan your backup QR code.
                </Text>
                <Pressable style={styles.primaryButton} onPress={() => void requestAccess()} accessibilityRole="button">
                  <Text style={styles.primaryButtonText}>Allow camera</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarcode}
            />
          </View>
        )}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Pressable style={styles.secondaryButton} onPress={onClose} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
    backgroundColor: '#111',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 24,
  },
  hint: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
  },
  permissionBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  permissionText: {
    color: '#eee',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  cameraWrap: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#2e7d32',
  },
  camera: {
    flex: 1,
  },
  error: {
    color: '#ffb4a9',
    fontSize: 14,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#9ecbff',
    fontSize: 15,
    fontWeight: '600',
  },
});
