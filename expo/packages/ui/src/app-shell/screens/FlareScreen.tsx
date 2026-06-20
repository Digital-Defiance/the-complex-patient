/**
 * @complex-patient/ui — FlareScreen
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import {
  createFlareJournal,
  type FlareJournal,
  type FlareUpInput,
  type FieldError,
  type SymptomEntry,
} from '@complex-patient/symptom-journal';
import { useAppHost } from '../app-host';
import { usePartition } from '../hooks';
import {
  createHomeFlareLookups,
  createHomeFlareStore,
} from '../symptom-journal-stores';

export interface FlareScreenProps {
  onBack?: () => void;
}

export function FlareScreen({ onBack }: FlareScreenProps): React.ReactElement {
  const { home } = useAppHost();

  if (!home) {
    return (
      <View style={styles.container} testID="flare-screen">
        <Text style={styles.errorText} accessibilityRole="alert" testID="flare-unavailable">
          Data unavailable. Please try again later.
        </Text>
      </View>
    );
  }

  return <FlareScreenInner home={home} onBack={onBack} />;
}

function FlareScreenInner({
  home,
  onBack,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
  onBack?: () => void;
}): React.ReactElement {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [trigger, setTrigger] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const journalRef = useRef<FlareJournal | null>(null);
  const symptomRecords = usePartition<SymptomEntry>(home, 'symptoms');

  const activeSymptoms = useMemo(
    () => symptomRecords.filter((symptom) => symptom.active),
    [symptomRecords],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const getJournal = useCallback((): FlareJournal | null => {
    if (!journalRef.current) {
      journalRef.current = createFlareJournal(
        createHomeFlareStore(home),
        createHomeFlareLookups(home),
      );
    }
    return journalRef.current;
  }, [home]);

  const toggleSymptom = useCallback((symptomId: string) => {
    setSelectedIds((current) =>
      current.includes(symptomId)
        ? current.filter((id) => id !== symptomId)
        : [...current, symptomId],
    );
    setSuccessMessage(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const journal = getJournal();
    if (!journal) return;

    const input: FlareUpInput = {
      symptomIds: selectedIds,
      trigger: trigger.trim(),
    };

    try {
      const result = await journal.logFlare(input);

      if (!result.ok) {
        setFieldErrors(result.errors);
        setCommitError(null);
        setSuccessMessage(null);
        return;
      }

      setFieldErrors([]);
      setCommitError(null);
      setSuccessMessage('Flare-up saved.');
      setSelectedIds([]);
      setTrigger('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Flare-up was not saved. Please try again.';
      setCommitError(message);
      setSuccessMessage(null);
    }
  }, [getJournal, selectedIds, trigger]);

  const canSubmit = selectedIds.length >= 2;

  return (
    <ScrollView style={styles.container} testID="flare-screen">
      <Text style={styles.title}>Log Flare-Up</Text>
      <Text style={styles.lead}>Select at least two active symptoms involved in this flare.</Text>

      {fieldErrors.length > 0 && (
        <View testID="flare-field-errors" accessibilityRole="alert">
          {fieldErrors.map((err, i) => (
            <Text key={`${err.field}-${i}`} style={styles.errorText} testID={`field-error-${err.field}`}>
              {err.field}: {err.message}
            </Text>
          ))}
        </View>
      )}

      {commitError && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="flare-commit-error">
          {commitError}
        </Text>
      )}

      {successMessage && (
        <Text style={styles.successText} testID="flare-success">
          {successMessage}
        </Text>
      )}

      {activeSymptoms.length === 0 ? (
        <Text style={styles.infoText} testID="flare-no-active-symptoms">
          No active symptoms available. Log symptoms first — they are active by default.
        </Text>
      ) : (
        <View style={styles.symptomList} testID="flare-active-symptoms">
          <Text style={styles.label}>Active symptoms ({selectedIds.length} selected)</Text>
          {activeSymptoms.map((symptom) => {
            const selected = selectedSet.has(symptom.id);
            return (
              <Pressable
                key={symptom.id}
                style={[styles.symptomOption, selected && styles.symptomOptionSelected]}
                onPress={() => toggleSymptom(symptom.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                testID={`flare-symptom-${symptom.id}`}
              >
                <View style={[styles.checkbox, selected && styles.checkboxChecked]} />
                <View style={styles.symptomOptionText}>
                  <Text style={styles.symptomTitle}>{symptom.symptomType}</Text>
                  <Text style={styles.symptomMeta}>
                    {symptom.systemicLocation} · Severity {symptom.severity}/10
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

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

      {!canSubmit && activeSymptoms.length > 0 && (
        <Text style={styles.hintText} testID="flare-selection-hint">
          Select at least 2 symptoms to log a flare-up.
        </Text>
      )}

      <Pressable
        style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Log flare-up"
        testID="flare-submit"
      >
        <Text style={styles.submitText}>Log Flare-Up</Text>
      </Pressable>

      {onBack && (
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="flare-back">
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
    marginBottom: 8,
    color: '#1a1a1a',
  },
  lead: {
    fontSize: 14,
    color: '#555',
    marginBottom: 16,
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
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
  triggerInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 4,
  },
  successText: {
    color: '#067a36',
    fontSize: 14,
    marginBottom: 12,
  },
  infoText: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  hintText: {
    color: '#555',
    fontSize: 14,
    marginTop: 8,
  },
  symptomList: {
    marginTop: 8,
    marginBottom: 8,
    gap: 8,
  },
  symptomOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fafafa',
  },
  symptomOptionSelected: {
    borderColor: '#cc6600',
    backgroundColor: '#fff8f0',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#cc6600',
    borderRadius: 4,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#cc6600',
  },
  symptomOptionText: {
    flex: 1,
  },
  symptomTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  symptomMeta: {
    fontSize: 13,
    color: '#555',
  },
  submitButton: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#cc6600',
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
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
