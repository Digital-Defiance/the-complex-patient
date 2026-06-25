/**
 * Web camera QR scanner for paper backup recovery (expo-camera web support).
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
    <Modal visible animationType="fade" onRequestClose={onClose} testID="paper-backup-qr-scanner-modal">
      <View style={styles.container}>
        <Text style={styles.title}>Scan paper backup QR</Text>
        <Text style={styles.hint}>Use your webcam to scan the QR code on your printed sheet.</Text>

        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            {permission === null ? (
              <ActivityIndicator accessibilityLabel="Checking camera permission" />
            ) : (
              <>
                <Text style={styles.permissionText}>
                  Allow camera access in your browser to scan the backup QR code.
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
              facing="environment"
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
    padding: 24,
    gap: 12,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
  },
  hint: {
    color: '#555',
    fontSize: 14,
    lineHeight: 20,
  },
  permissionBox: {
    minHeight: 220,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  permissionText: {
    color: '#444',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  cameraWrap: {
    minHeight: 320,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#2e7d32',
    backgroundColor: '#000',
  },
  camera: {
    width: '100%',
    height: 320,
  },
  error: {
    color: '#c62828',
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
    color: '#0066cc',
    fontSize: 15,
    fontWeight: '600',
  },
});
