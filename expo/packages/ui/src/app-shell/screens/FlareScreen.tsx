/**
 * @complex-patient/ui — FlareScreen
 *
 * Renders the flare-up logging form. Routes flare-ups exclusively through
 * `createFlareJournal` (no other path). On a returned FieldError, displays it
 * and retains entered values; clears the error on a successful submission.
 * Persists exclusively through `home.commit` and retains values on commit
 * failure.
 *
 * Requirements: 10.2, 10.5, 10.6, 10.7, 10.8
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import {
  createFlareJournal,
  type FlareJournal,
  type FlareUpInput,
  type FlareStore,
  type FlareLookups,
  type FieldError,
  type FlareUp,
  type SymptomEntry,
} from '@complex-patient/symptom-journal';
import { useAppHost } from '../app-host';

/**
 * Props for the FlareScreen. The `onBack` callback is supplied by the route
 * file so the screen stays decoupled from the router.
 */
export interface FlareScreenProps {
  /** Navigate back to the previous screen. */
  onBack?: () => void;
}

/**
 * Build a FlareStore that delegates reads to `home.read('flares')` and writes
 * to `home.commit('flares', ...)`. This ensures persistence goes exclusively
 * through `home.commit` (Requirement 10.7).
 */
function createHomeFlareStore(home: NonNullable<ReturnType<typeof useAppHost>['home']>): FlareStore {
  return {
    async readFlares(): Promise<FlareUp[]> {
      return home.read<FlareUp>('flares').records;
    },
    async writeFlares(records: FlareUp[]): Promise<void> {
      const result = await home.commit<FlareUp>('flares', () => records);
      if (!result.ok) {
        throw new Error(result.message);
      }
    },
  };
}

/**
 * Build FlareLookups that reads active symptoms from `home.read('symptoms')`.
 * Only symptoms with `active: true` are eligible for flare selection (17.1).
 */
function createHomeFlareLookups(home: NonNullable<ReturnType<typeof useAppHost>['home']>): FlareLookups {
  return {
    async activeSymptomIds(): Promise<Iterable<string>> {
      const symptoms = home.read<SymptomEntry>('symptoms').records;
      return symptoms.filter((s) => s.active).map((s) => s.id);
    },
  };
}

export function FlareScreen({ onBack }: FlareScreenProps): React.ReactElement {
  const { home } = useAppHost();

  // Form state — retained on both field errors and commit failures.
  const [selectedSymptomIds, setSelectedSymptomIds] = useState('');
  const [trigger, setTrigger] = useState('');

  // Active symptoms for display.
  const [activeSymptoms, setActiveSymptoms] = useState<SymptomEntry[]>([]);

  // Error state — field errors from the flare journal engine.
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  // Commit failure state — from home.commit failing.
  const [commitError, setCommitError] = useState<string | null>(null);

  // Journal engine ref — created once per home controller.
  const journalRef = useRef<FlareJournal | null>(null);

  const getJournal = useCallback((): FlareJournal | null => {
    if (!home) return null;
    if (!journalRef.current) {
      const store = createHomeFlareStore(home);
      const lookups = createHomeFlareLookups(home);
      journalRef.current = createFlareJournal(store, lookups);
    }
    return journalRef.current;
  }, [home]);

  // Load active symptoms on mount for display.
  useEffect(() => {
    if (!home) return;
    try {
      const symptoms = home.read<SymptomEntry>('symptoms').records;
      setActiveSymptoms(symptoms.filter((s) => s.active));
    } catch {
      setActiveSymptoms([]);
    }
  }, [home]);

  const handleSubmit = useCallback(async () => {
    const journal = getJournal();
    if (!journal) return;

    // Parse comma-separated symptom IDs from the text input.
    const symptomIds = selectedSymptomIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');

    const input: FlareUpInput = {
      symptomIds,
      trigger,
    };

    try {
      const result = await journal.logFlare(input);

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
      setSelectedSymptomIds('');
      setTrigger('');
    } catch {
      // Requirement 10.8: on commit failure, display persistence-failure message
      // and retain entered values.
      setCommitError('Flare-up was not saved. Please try again.');
    }
  }, [getJournal, selectedSymptomIds, trigger]);

  if (!home) {
    return (
      <View style={styles.container} testID="flare-screen">
        <Text style={styles.errorText} accessibilityRole="alert" testID="flare-unavailable">
          Data unavailable. Please try again later.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="flare-screen">
      <Text style={styles.title}>Log Flare-Up</Text>

      {/* Field errors (Requirement 10.5) */}
      {fieldErrors.length > 0 && (
        <View testID="flare-field-errors" accessibilityRole="alert">
          {fieldErrors.map((err, i) => (
            <Text key={`${err.field}-${i}`} style={styles.errorText} testID={`field-error-${err.field}`}>
              {err.field}: {err.message}
            </Text>
          ))}
        </View>
      )}

      {/* Commit failure (Requirement 10.8) */}
      {commitError && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="flare-commit-error">
          {commitError}
        </Text>
      )}

      {/* Active symptoms list for reference */}
      {activeSymptoms.length > 0 && (
        <View style={styles.symptomList} testID="flare-active-symptoms">
          <Text style={styles.label}>Active Symptoms (select 2–50 for a flare)</Text>
          {activeSymptoms.map((s) => (
            <Text key={s.id} style={styles.symptomItem} testID={`active-symptom-${s.id}`}>
              • {s.symptomType} ({s.systemicLocation}) — ID: {s.id}
            </Text>
          ))}
        </View>
      )}

      {activeSymptoms.length === 0 && (
        <Text style={styles.infoText} testID="flare-no-active-symptoms">
          No active symptoms available. Log symptoms first and mark them as active.
        </Text>
      )}

      {/* Symptom IDs input */}
      <Text style={styles.label}>Symptom IDs (comma-separated)</Text>
      <TextInput
        style={[styles.input, styles.idsInput]}
        value={selectedSymptomIds}
        onChangeText={setSelectedSymptomIds}
        placeholder="Enter symptom IDs separated by commas"
        multiline
        accessibilityLabel="Symptom IDs"
        testID="flare-symptom-ids"
      />

      {/* Trigger */}
      <Text style={styles.label}>Trigger (optional, max 500 chars)</Text>
      <TextInput
        style={[styles.input, styles.triggerInput]}
        value={trigger}
        onChangeText={setTrigger}
        placeholder="e.g. Weather change, Stress, Diet"
        multiline
        maxLength={500}
        accessibilityLabel="Trigger"
        testID="flare-trigger"
      />

      {/* Submit */}
      <Pressable
        style={styles.submitButton}
        onPress={handleSubmit}
        accessibilityRole="button"
        accessibilityLabel="Log flare-up"
        testID="flare-submit"
      >
        <Text style={styles.submitText}>Log Flare-Up</Text>
      </Pressable>

      {/* Back */}
      {onBack && (
        <Pressable
          style={styles.backButton}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="flare-back"
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
  idsInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  triggerInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 4,
  },
  infoText: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  symptomList: {
    marginTop: 8,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  symptomItem: {
    fontSize: 13,
    color: '#444',
    marginTop: 4,
  },
  submitButton: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#cc6600',
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
