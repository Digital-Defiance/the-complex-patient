/**
 * @complex-patient/ui — HomeScreen
 *
 * Rendered while the Home_Controller status is `ready`. Presents navigation
 * entries for the Medications, Symptom Journal, and Insights subsystems, plus
 * a Sign Out button. Reads displayed data exclusively through `home.read` and
 * on read failure displays a data-unavailable message with no stale/partial PHI.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PASSKEY_SETUP_SESSION_KEY } from '@complex-patient/key-store';
import { useAppHost } from '../app-host';

/**
 * Props for the HomeScreen — the navigation callback is supplied by the route
 * file so the screen stays decoupled from Expo Router directly.
 */
export interface HomeScreenProps {
  /** Navigate to a subsystem by name. */
  onNavigate: (subsystem: 'medications' | 'journal' | 'insights' | 'export' | 'import' | 'settings') => void;
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
  const insets = useSafeAreaInsets();

  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [readError, setReadError] = useState(false);
  const [passkeyBannerVisible, setPasskeyBannerVisible] = useState(false);
  const [passkeySetupLoading, setPasskeySetupLoading] = useState(false);
  const [passkeySetupError, setPasskeySetupError] = useState<string | null>(null);
  const [passkeySetupSuccess, setPasskeySetupSuccess] = useState(false);
  const [passkeyPromptHighlight, setPasskeyPromptHighlight] = useState(false);

  const handleEnablePasskey = useCallback(async () => {
    if (!home?.enablePasskeyUnlock) {
      setPasskeySetupError('Passkey unlock is not available in this app build.');
      return;
    }

    setPasskeySetupLoading(true);
    setPasskeySetupError(null);
    setPasskeySetupSuccess(false);

    try {
      const result = await home.enablePasskeyUnlock();
      if (result.ok) {
        setPasskeyBannerVisible(false);
        setPasskeyPromptHighlight(false);
        setPasskeySetupSuccess(true);
        return;
      }

      setPasskeySetupError(result.message);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Passkey setup failed.';
      setPasskeySetupError(message);
    } finally {
      setPasskeySetupLoading(false);
    }
  }, [home]);

  useEffect(() => {
    if (!home?.isPasskeyUnlockAvailable?.() || home?.hasPasskeyUnlock?.()) {
      setPasskeyBannerVisible(false);
      setPasskeyPromptHighlight(false);
      return;
    }

    setPasskeyBannerVisible(true);

    const offered =
      typeof globalThis.sessionStorage !== 'undefined' &&
      globalThis.sessionStorage.getItem(PASSKEY_SETUP_SESSION_KEY) === '1';
    if (offered) {
      globalThis.sessionStorage.removeItem(PASSKEY_SETUP_SESSION_KEY);
      setPasskeyPromptHighlight(true);
    }
  }, [home]);

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
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="none"
      accessibilityLabel="Home"
    >
      <Text style={styles.title}>Home</Text>

      {passkeySetupSuccess && (
        <Text style={styles.passkeySuccessText} testID="home-passkey-setup-success">
          Passkey saved. Next time you return, use passkey unlock instead of your passphrase.
        </Text>
      )}

      {passkeyBannerVisible && (
        <View
          style={[styles.passkeyBanner, passkeyPromptHighlight && styles.passkeyBannerHighlight]}
          testID="home-passkey-setup-banner"
        >
          <Text style={styles.passkeyBannerTitle}>
            {passkeyPromptHighlight ? 'Save passkey for faster unlock?' : 'Faster unlock on this browser'}
          </Text>
          <Text style={styles.passkeyBannerText}>
            When you switch tabs, your vault locks for security. Save a passkey to unlock instantly
            without re-entering your master passphrase or waiting for key derivation.
          </Text>
          {passkeySetupError && (
            <Text style={styles.passkeyBannerError} accessibilityRole="alert" testID="home-passkey-setup-error">
              {passkeySetupError}
            </Text>
          )}
          <Pressable
            style={[styles.passkeyBannerButton, passkeySetupLoading && styles.buttonDisabled]}
            onPress={handleEnablePasskey}
            disabled={passkeySetupLoading}
            accessibilityRole="button"
            accessibilityLabel="Save passkey for faster unlock"
            testID="home-passkey-setup-button"
          >
            {passkeySetupLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.passkeyBannerButtonText}>Save passkey</Text>
            )}
          </Pressable>
        </View>
      )}

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
          onPress={() => onNavigate('medications')}
          accessibilityRole="button"
          accessibilityLabel="Medications"
          testID="home-nav-medications"
        >
          <Text style={styles.navButtonText}>Medications</Text>
          <Text style={styles.navButtonSubtext}>Today queue, cabinet, schedules &amp; PRN logs</Text>
        </Pressable>

        <Pressable
          style={styles.navButton}
          onPress={() => onNavigate('journal')}
          accessibilityRole="button"
          accessibilityLabel="Symptom Journal"
          testID="home-nav-journal"
        >
          <Text style={styles.navButtonText}>Symptom Journal</Text>
          <Text style={styles.navButtonSubtext}>Log symptoms, view history, and flare-ups</Text>
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

        <Pressable
          style={styles.navButton}
          onPress={() => onNavigate('export')}
          accessibilityRole="button"
          accessibilityLabel="Clinical export"
          testID="home-nav-export"
        >
          <Text style={styles.navButtonText}>Clinical Export</Text>
          <Text style={styles.navButtonSubtext}>FHIR bundle in a password-protected zip</Text>
        </Pressable>

        <Pressable
          style={styles.navButton}
          onPress={() => onNavigate('import')}
          accessibilityRole="button"
          accessibilityLabel="Import clinical export"
          testID="home-nav-import"
        >
          <Text style={styles.navButtonText}>Import Export</Text>
          <Text style={styles.navButtonSubtext}>Preview a previously exported zip file</Text>
        </Pressable>

        <Pressable
          style={styles.navButton}
          onPress={() => onNavigate('settings')}
          accessibilityRole="button"
          accessibilityLabel="Weather and location settings"
          testID="home-nav-settings"
        >
          <Text style={styles.navButtonText}>Weather &amp; Location</Text>
          <Text style={styles.navButtonSubtext}>Optional location on med logs and chart overlays</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 24,
    gap: 12,
  },
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
  passkeyBanner: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#b8d4f0',
  },
  passkeyBannerHighlight: {
    borderColor: '#0066cc',
    borderWidth: 2,
    backgroundColor: '#e8f2ff',
  },
  passkeyBannerError: {
    color: '#b00020',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  passkeySuccessText: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    color: '#1b5e20',
    fontSize: 14,
    lineHeight: 20,
  },
  passkeyBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#004488',
    marginBottom: 8,
  },
  passkeyBannerText: {
    fontSize: 14,
    color: '#444',
    marginBottom: 12,
    lineHeight: 20,
  },
  passkeyBannerButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#0066cc',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  passkeyBannerButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
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
    marginTop: 12,
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
