/**
 * @complex-patient/ui — LoadingScreen
 *
 * Displayed while the app is in a loading/checking state (e.g., onboarding
 * status is `checking`, or `home` has not yet been resolved). This screen
 * renders a simple activity indicator with no onboarding, authenticated, or
 * error content.
 *
 * Requirements: 4.4, 5.2
 */

import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

export function LoadingScreen(): React.ReactElement {
  return (
    <View
      style={styles.container}
      accessibilityRole="none"
      accessibilityLabel="Loading"
    >
      <ActivityIndicator size="large" color="#0066cc" />
      <Text style={styles.message}>Loading…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    color: '#555',
  },
});
