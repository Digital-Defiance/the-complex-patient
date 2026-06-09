/**
 * @complex-patient/ui — SecureContextRequiredScreen
 *
 * Blocking screen rendered when the web app is loaded outside a Secure_Context
 * (no HTTPS, so `window.crypto.subtle` is unavailable). This screen:
 * - Displays a clear message: "A secure (HTTPS) context is required"
 * - Does NOT render any onboarding or authenticated content
 * - Does NOT construct a Local_Vault
 *
 * Requirements: 4.2, 4.4
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function SecureContextRequiredScreen(): React.ReactElement {
  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLabel="Secure context required"
    >
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.title}>Secure Context Required</Text>
      <Text style={styles.message}>
        A secure (HTTPS) context is required to use this application. Please
        access the app over HTTPS to enable encryption and proceed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    color: '#555',
    lineHeight: 24,
    maxWidth: 400,
  },
});
