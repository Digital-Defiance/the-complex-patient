/**
 * @complex-patient/ui — HomeScreen
 *
 * Rendered while the Home_Controller status is `ready`. Presents navigation
 * entries for the Polypharmacy, Symptom Journal, and Insights subsystems, plus
 * a Sign Out button. Reads displayed data exclusively through `home.read` and
 * on read failure displays a data-unavailable message with no stale/partial PHI.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAppHost } from '../app-host';

/**
 * Props for the HomeScreen — the navigation callback is supplied by the route
 * file so the screen stays decoupled from Expo Router directly.
 */
export interface HomeScreenProps {
  /** Navigate to a subsystem by name. */
  onNavigate: (subsystem: 'polypharmacy' | 'journal' | 'insights') => void;
  /** Navigate to the sign-in screen after sign-out completes. */
  onSignedOut: () => void;
}

/**
 * Summary data read from the home controller. This is the projection read
 * exclusively through `home.read` — no direct vault access. On failure, no
 * stale/partial PHI is shown.
 */
interface HomeSummary {
  medicationCount: number;
  symptomCount: number;
}

export function HomeScreen({ onNavigate, onSignedOut }: HomeScreenProps): React.ReactElement {
  const { home } = useAppHost();

  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [readError, setReadError] = useState(false);

  // Read displayed data exclusively through home.read (Requirement 8.6).
  // On failure, show data-unavailable and render no stale/partial PHI (Requirement 8.8).
  useEffect(() => {
    if (!home) {
      setReadError(true);
      return;
    }

    try {
      const medications = home.read('medications');
      const symptoms = home.read('symptoms');
      setSummary({
        medicationCount: medications.records.length,
        symptomCount: symptoms.records.length,
      });
      setReadError(false);
    } catch {
      // Requirement 8.8: on read failure, show data-unavailable, no stale PHI.
      setSummary(null);
      setReadError(true);
    }
  }, [home]);

  // Wire sign-out through home.signOut then navigate to sign-in (Requirement 8.5).
  const handleSignOut = useCallback(async () => {
    if (!home) return;
    await home.signOut();
    onSignedOut();
  }, [home, onSignedOut]);

  // If home is not available (shouldn't happen on this screen), show unavailable.
  if (!home) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Home">
        <Text style={styles.errorText} accessibilityRole="alert" testID="home-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityRole="none" accessibilityLabel="Home">
      <Text style={styles.title}>Home</Text>

      {readError && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="home-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
      )}

      {!readError && summary && (
        <View style={styles.summaryContainer} testID="home-summary">
          <Text style={styles.summaryText}>
            {summary.medicationCount} medication{summary.medicationCount !== 1 ? 's' : ''}
          </Text>
          <Text style={styles.summaryText}>
            {summary.symptomCount} symptom{summary.symptomCount !== 1 ? 's' : ''} logged
          </Text>
        </View>
      )}

      {/* Navigation entries for subsystems (Requirement 8.4, 8.7) */}
      <View style={styles.navContainer}>
        <Pressable
          style={styles.navButton}
          onPress={() => onNavigate('polypharmacy')}
          accessibilityRole="button"
          accessibilityLabel="Polypharmacy"
          testID="home-nav-polypharmacy"
        >
          <Text style={styles.navButtonText}>Polypharmacy</Text>
          <Text style={styles.navButtonSubtext}>Manage medications &amp; PRN logs</Text>
        </Pressable>

        <Pressable
          style={styles.navButton}
          onPress={() => onNavigate('journal')}
          accessibilityRole="button"
          accessibilityLabel="Symptom Journal"
          testID="home-nav-journal"
        >
          <Text style={styles.navButtonText}>Symptom Journal</Text>
          <Text style={styles.navButtonSubtext}>Log symptoms &amp; flare-ups</Text>
        </Pressable>

        <Pressable
          style={styles.navButton}
          onPress={() => onNavigate('insights')}
          accessibilityRole="button"
          accessibilityLabel="Insights"
          testID="home-nav-insights"
        >
          <Text style={styles.navButtonText}>Insights</Text>
          <Text style={styles.navButtonSubtext}>View correlations &amp; reports</Text>
        </Pressable>
      </View>

      {/* Sign Out button (Requirement 8.5) */}
      <Pressable
        style={styles.signOutButton}
        onPress={handleSignOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        testID="home-sign-out"
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 16,
    color: '#1a1a1a',
  },
  errorText: {
    color: '#c00',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  summaryContainer: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  summaryText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
  navContainer: {
    flex: 1,
    gap: 12,
  },
  navButton: {
    padding: 20,
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0e3f5',
  },
  navButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0066cc',
    marginBottom: 4,
  },
  navButtonSubtext: {
    fontSize: 14,
    color: '#555',
  },
  signOutButton: {
    marginTop: 24,
    padding: 16,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  signOutText: {
    fontSize: 16,
    color: '#c00',
    fontWeight: '500',
  },
});
