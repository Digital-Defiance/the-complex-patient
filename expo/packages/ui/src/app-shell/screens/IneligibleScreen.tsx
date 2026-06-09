/**
 * @complex-patient/ui — IneligibleScreen
 *
 * Terminal screen rendered when the Onboarding_Controller status is `ineligible`
 * (including when `start()` reports `ineligible` directly). This screen:
 * - Displays a clear message indicating the user is not eligible and cannot proceed
 * - Omits ANY control (button, link, back-navigation) that returns to the age-gate
 * - Is wrapped in an error boundary that falls back to the age-gate screen if the
 *   ineligibility screen fails to render
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AgeGateScreen } from './AgeGateScreen';

/**
 * The terminal ineligibility screen content. Renders an informational message
 * with no interactive controls that could navigate back to the age-gate.
 *
 * Requirements: 6.1, 6.2, 6.3
 */
export function IneligibleScreenContent(): React.ReactElement {
  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLabel="Not eligible"
      testID="ineligible-screen"
    >
      <Text style={styles.icon}>🚫</Text>
      <Text style={styles.title}>Not Eligible</Text>
      <Text style={styles.message}>
        You are not eligible to use this application and cannot proceed.
        If you believe this is an error, please contact support.
      </Text>
    </View>
  );
}

/**
 * Error boundary props for the ineligibility screen fallback.
 */
interface IneligibleErrorBoundaryProps {
  children: React.ReactNode;
  /** Fallback component rendered when the ineligibility screen fails (Requirement 6.4). */
  fallback: React.ReactNode;
}

interface IneligibleErrorBoundaryState {
  hasError: boolean;
}

/**
 * Error boundary wrapping the ineligibility screen. If IneligibleScreenContent
 * throws during render, the boundary catches the error and renders the provided
 * fallback (the age-gate screen per Requirement 6.4).
 *
 * Requirement: 6.4
 */
export class IneligibleErrorBoundary extends React.Component<
  IneligibleErrorBoundaryProps,
  IneligibleErrorBoundaryState
> {
  constructor(props: IneligibleErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): IneligibleErrorBoundaryState {
    return { hasError: true };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * The full IneligibleScreen with error boundary. Falls back to the age-gate
 * screen if the ineligibility screen fails to render (Requirement 6.4).
 *
 * When the error boundary catches, it renders the actual AgeGateScreen so the
 * user can still interact with the application.
 */
export function IneligibleScreen(): React.ReactElement {
  return (
    <IneligibleErrorBoundary fallback={<AgeGateScreen />}>
      <IneligibleScreenContent />
    </IneligibleErrorBoundary>
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
