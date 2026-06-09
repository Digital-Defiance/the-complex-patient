/**
 * @complex-patient/ui — AgeGateScreen
 *
 * The first onboarding screen. Rendered while the onboarding controller status
 * is `age-gate`. Collects a birth-month (1–12) and a four-digit birth-year,
 * routes submission through `onboarding.submitAge`, and handles the
 * `INVALID_AGE_INPUT` re-prompt. Also surfaces:
 * - A loading indicator while `checking` (Requirement 5.2)
 * - An error message if `onboarding.start()` rejects (Requirement 5.3)
 *
 * Privacy: birth month/year are held only in local component state for the
 * in-memory `submitAge` call. They are NEVER written to storage, transmitted
 * to the backend, or placed in any request (Requirement 5.9).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useAppHost } from '../app-host';

export function AgeGateScreen(): React.ReactElement {
  const { onboarding, enterHome, startFailed, submitAge } = useAppHost();

  // Local UI state -------------------------------------------------------
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [reprompt, setReprompt] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Render: start() failure (Requirement 5.3) ----------------------------
  if (startFailed) {
    return (
      <View
        style={styles.container}
        accessibilityRole="alert"
        accessibilityLabel="Onboarding start failed"
        testID="age-gate-start-failed"
      >
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Unable to Start Onboarding</Text>
        <Text style={styles.message}>
          Something went wrong while starting the onboarding process. Please try
          again later.
        </Text>
      </View>
    );
  }

  // Submit handler -------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    setReprompt(false);
    setSubmitting(true);

    const month = parseInt(birthMonth, 10);
    const year = parseInt(birthYear, 10);

    try {
      // Use the AppHost's submitAge which updates navState + calls the controller.
      await submitAge({ birthMonth: month, birthYear: year });

      // After submitAge, check the controller status for the result.
      const status = onboarding.getStatus();
      if (status === 'age-gate') {
        // Still on age-gate means INVALID_AGE_INPUT — show re-prompt.
        setReprompt(true);
      } else if (status === 'eligible') {
        // Eligible — build the Home_Controller.
        await enterHome();
      }
      // If 'ineligible', the navState update in submitAge already triggers
      // the route resolver to navigate away.
    } catch {
      setReprompt(true);
    } finally {
      setSubmitting(false);
    }
  }, [birthMonth, birthYear, onboarding, enterHome, submitAge]);

  // Render: age-gate form (Requirements 5.4, 5.5, 5.6) ------------------
  return (
    <View style={styles.container} testID="age-gate-screen">
      <Text style={styles.title}>Age Verification</Text>
      <Text style={styles.subtitle}>
        Please enter your birth month and year to continue.
      </Text>

      {reprompt && (
        <Text
          style={styles.reprompt}
          accessibilityRole="alert"
          testID="age-gate-reprompt"
        >
          The information entered is not valid. Please check your birth month and
          year and try again.
        </Text>
      )}

      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.label} nativeID="birth-month-label">
            Birth Month (1–12)
          </Text>
          <TextInput
            style={styles.input}
            value={birthMonth}
            onChangeText={setBirthMonth}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="MM"
            accessibilityLabelledBy={'birth-month-label' as unknown as string}
            accessibilityLabel="Birth month"
            testID="age-gate-birth-month"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label} nativeID="birth-year-label">
            Birth Year (4 digits)
          </Text>
          <TextInput
            style={styles.input}
            value={birthYear}
            onChangeText={setBirthYear}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="YYYY"
            accessibilityLabelledBy={'birth-year-label' as unknown as string}
            accessibilityLabel="Birth year"
            testID="age-gate-birth-year"
          />
        </View>
      </View>

      <Pressable
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel="Submit age verification"
        testID="age-gate-submit"
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </Pressable>
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
    marginBottom: 8,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#555',
    marginBottom: 24,
    maxWidth: 400,
  },
  reprompt: {
    fontSize: 14,
    color: '#cc0000',
    backgroundColor: '#fff0f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    textAlign: 'center',
    maxWidth: 400,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  inputGroup: {
    flex: 1,
    maxWidth: 160,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  button: {
    backgroundColor: '#0066cc',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 160,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    color: '#555',
    lineHeight: 24,
    maxWidth: 400,
  },
});
