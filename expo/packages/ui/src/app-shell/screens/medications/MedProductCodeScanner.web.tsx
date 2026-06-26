/**
 * Web fallback — barcode scanning is not available; prompt manual entry.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MedProductCodeScannerProps } from './MedProductCodeScanner';

export function MedProductCodeScanner({ onClose }: MedProductCodeScannerProps): React.ReactElement {
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} testID="med-product-code-scanner-modal">
      <View style={styles.container}>
        <Text style={styles.title}>Barcode scanning</Text>
        <Text style={styles.body}>
          Camera barcode scanning is available in the mobile app. On web, type the NDC or product code manually
          in the field below.
        </Text>
        <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
          <Text style={styles.buttonText}>OK</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: '#555',
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
