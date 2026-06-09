/**
 * @complex-patient/ui — CompositionFailedScreen
 *
 * Blocking screen rendered when the application controller composition fails
 * for a reason other than a missing secure context (e.g., `createMobileApp` or
 * `createHome` rejects). This screen:
 * - Displays a clear message: "Application failed to initialize"
 * - Does NOT render any onboarding or authenticated content
 * - Does NOT construct a Local_Vault
 *
 * Requirements: 3.8, 4.5
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function CompositionFailedScreen(): React.ReactElement {
  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLabel="Application initialization failed"
    >
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>Application Failed to Initialize</Text>
      <Text style={styles.message}>
        The application could not start. Please try again later or contact
        support if the problem persists.
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
