/**
 * @complex-patient/ui — SymptomJournalLogScreen
 *
 * Renders the symptom journal log form. Routes symptom entries exclusively
 * through `createSymptomJournal` (no other path). On a returned FieldError,
 * displays it and retains entered values; clears the error on a successful
 * submission. Persists exclusively through `home.commit` and retains values
 * on commit failure.
 *
 * Requirements: 10.1, 10.5, 10.6, 10.7, 10.8
 */

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import {
  createSymptomJournal,
  type SymptomJournal,
  type SymptomEntryInput,
  type SymptomStore,
  type FieldError,
  type SymptomEntry,
} from '@complex-patient/symptom-journal';
import { useAppHost } from '../app-host';

/**
 * Props for the SymptomJournalLogScreen. The `onBack` callback is supplied by
 * the route file so the screen stays decoupled from the router.
 */
export interface SymptomJournalLogScreenProps {
  /** Navigate back to the previous screen. */
  onBack?: () => void;
}

/**
 * Build a SymptomStore that delegates reads to `home.read('symptoms')` and
 * writes to `home.commit('symptoms', ...)`. This ensures persistence goes
 * exclusively through `home.commit` (Requirement 10.7).
 */
function createHomeSymptomStore(home: NonNullable<ReturnType<typeof useAppHost>['home']>): SymptomStore {
  return {
    async readSymptoms(): Promise<SymptomEntry[]> {
      return home.read<SymptomEntry>('symptoms').records;
    },
    async writeSymptoms(records: SymptomEntry[]): Promise<void> {
      const result = await home.commit<SymptomEntry>('symptoms', () => records);
      if (!result.ok) {
        throw new Error(result.message);
      }
    },
  };
}

export function SymptomJournalLogScreen({ onBack }: SymptomJournalLogScreenProps): React.ReactElement {
  const { home } = useAppHost();

  // Form state — retained on both field errors and commit failures.
  const [symptomType, setSymptomType] = useState('');
  const [systemicLocation, setSystemicLocation] = useState('');
  const [severity, setSeverity] = useState('');
  const [durationValue, setDurationValue] = useState('');
  const [durationUnit, setDurationUnit] = useState('hours');
  const [notes, setNotes] = useState('');

  // Error state — field errors from the journal engine.
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  // Commit failure state — from home.commit failing.
  const [commitError, setCommitError] = useState<string | null>(null);

  // Journal engine ref — created once per home controller.
  const journalRef = useRef<SymptomJournal | null>(null);

  const getJournal = useCallback((): SymptomJournal | null => {
    if (!home) return null;
    if (!journalRef.current) {
      const store = createHomeSymptomStore(home);
      journalRef.current = createSymptomJournal(store);
    }
    return journalRef.current;
  }, [home]);

  const handleSubmit = useCallback(async () => {
    const journal = getJournal();
    if (!journal) return;

    const input: SymptomEntryInput = {
      symptomType,
      systemicLocation,
      severity: severity !== '' ? Number(severity) : undefined,
      duration: {
        value: durationValue !== '' ? Number(durationValue) : undefined,
        unit: durationUnit,
      },
      notes: notes || undefined,
      active: true,
    };

    try {
      const result = await journal.logSymptom(input);

      if (!result.ok) {
        // Requirement 10.5: display the returned field error and retain entered values.
        setFieldErrors(result.errors);
        setCommitError(null);
        return;
      }

      // Requirement 10.6: clear the displayed field error on successful submission.
      setFieldErrors([]);
      setCommitError(null);

      // Clear form on success.
      setSymptomType('');
      setSystemicLocation('');
      setSeverity('');
      setDurationValue('');
      setDurationUnit('hours');
      setNotes('');
    } catch {
      // Requirement 10.8: on commit failure, display persistence-failure message
      // and retain entered values.
      setCommitError('Symptom was not saved. Please try again.');
    }
  }, [getJournal, symptomType, systemicLocation, severity, durationValue, durationUnit, notes]);

  if (!home) {
    return (
      <View style={styles.container} testID="journal-log-screen">
        <Text style={styles.errorText} accessibilityRole="alert" testID="journal-log-unavailable">
          Data unavailable. Please try again later.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="journal-log-screen">
      <Text style={styles.title}>Log Symptom</Text>

      {/* Field errors (Requirement 10.5) */}
      {fieldErrors.length > 0 && (
        <View testID="journal-log-field-errors" accessibilityRole="alert">
          {fieldErrors.map((err, i) => (
            <Text key={`${err.field}-${i}`} style={styles.errorText} testID={`field-error-${err.field}`}>
              {err.field}: {err.message}
            </Text>
          ))}
        </View>
      )}

      {/* Commit failure (Requirement 10.8) */}
      {commitError && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="journal-log-commit-error">
          {commitError}
        </Text>
      )}

      {/* Symptom Type */}
      <Text style={styles.label}>Symptom Type</Text>
      <TextInput
        style={styles.input}
        value={symptomType}
        onChangeText={setSymptomType}
        placeholder="e.g. Headache, Joint pain"
        accessibilityLabel="Symptom type"
        testID="journal-log-symptom-type"
      />

      {/* Systemic Location */}
      <Text style={styles.label}>Systemic Location</Text>
      <TextInput
        style={styles.input}
        value={systemicLocation}
        onChangeText={setSystemicLocation}
        placeholder="e.g. Head, Left knee"
        accessibilityLabel="Systemic location"
        testID="journal-log-systemic-location"
      />

      {/* Severity */}
      <Text style={styles.label}>Severity (1–10)</Text>
      <TextInput
        style={styles.input}
        value={severity}
        onChangeText={setSeverity}
        placeholder="1–10"
        keyboardType="numeric"
        accessibilityLabel="Severity"
        testID="journal-log-severity"
      />

      {/* Duration */}
      <Text style={styles.label}>Duration</Text>
      <View style={styles.durationRow}>
        <TextInput
          style={[styles.input, styles.durationInput]}
          value={durationValue}
          onChangeText={setDurationValue}
          placeholder="Value"
          keyboardType="numeric"
          accessibilityLabel="Duration value"
          testID="journal-log-duration-value"
        />
        <TextInput
          style={[styles.input, styles.durationInput]}
          value={durationUnit}
          onChangeText={setDurationUnit}
          placeholder="Unit (minutes, hours, days, weeks)"
          accessibilityLabel="Duration unit"
          testID="journal-log-duration-unit"
        />
      </View>

      {/* Notes */}
      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Additional notes (optional)"
        multiline
        accessibilityLabel="Notes"
        testID="journal-log-notes"
      />

      {/* Submit */}
      <Pressable
        style={styles.submitButton}
        onPress={handleSubmit}
        accessibilityRole="button"
        accessibilityLabel="Log symptom"
        testID="journal-log-submit"
      >
        <Text style={styles.submitText}>Log Symptom</Text>
      </Pressable>

      {/* Back */}
      {onBack && (
        <Pressable
          style={styles.backButton}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="journal-log-back"
        >
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
    color: '#1a1a1a',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  durationRow: {
    flexDirection: 'row',
    gap: 8,
  },
  durationInput: {
    flex: 1,
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 4,
  },
  submitButton: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#0066cc',
    borderRadius: 8,
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    marginTop: 12,
    padding: 16,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  backText: {
    fontSize: 16,
    color: '#555',
  },
});
