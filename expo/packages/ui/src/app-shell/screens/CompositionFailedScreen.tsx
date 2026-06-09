/**
 * @complex-patient/ui — CompositionFailedScreen
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAppHost } from '../app-host';

export function CompositionFailedScreen(): React.ReactElement {
  const { navState } = useAppHost();
  const errorMsg = (navState as any)._errorMessage || 'Unknown error';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>Application Failed to Initialize</Text>
      <Text style={styles.message}>
        The application could not start. Error details:
      </Text>
      <Text style={styles.error}>{errorMsg}</Text>
    </ScrollView>
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
    marginBottom: 12,
  },
  error: {
    fontSize: 13,
    color: '#c00',
    fontFamily: 'monospace',
    textAlign: 'center',
    padding: 12,
    backgroundColor: '#fff0f0',
    borderRadius: 8,
    maxWidth: 400,
  },
});
