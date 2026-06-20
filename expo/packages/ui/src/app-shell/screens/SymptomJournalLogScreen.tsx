/**
 * @complex-patient/ui — SymptomJournalLogScreen
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import {
  createSymptomJournal,
  type SymptomJournal,
  type SymptomEntryInput,
  type FieldError,
  type TimeUnit,
} from '@complex-patient/symptom-journal';
import { useAppHost } from '../app-host';
import { usePartition } from '../hooks';
import { createHomeSymptomStore } from '../symptom-journal-stores';
import {
  DURATION_UNITS,
  normalizeSymptomLabel,
  resolveSymptomTypeMatch,
  suggestSymptomTypes,
  suggestSystemicLocations,
} from '../symptom-journal-ui';

export interface SymptomJournalLogScreenProps {
  onBack?: () => void;
  onViewHistory?: () => void;
}

function SuggestionList({
  suggestions,
  onSelect,
  testID,
}: {
  suggestions: string[];
  onSelect: (value: string) => void;
  testID: string;
}): React.ReactElement | null {
  if (suggestions.length === 0) return null;

  return (
    <View style={styles.suggestionList} testID={testID}>
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion}
          style={styles.suggestionItem}
          onPress={() => onSelect(suggestion)}
          accessibilityRole="button"
          testID={`${testID}-${suggestion.replace(/\s+/g, '-').toLowerCase()}`}
        >
          <Text style={styles.suggestionText}>{suggestion}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function SymptomJournalLogScreen({ onBack, onViewHistory }: SymptomJournalLogScreenProps): React.ReactElement {
  const { home } = useAppHost();

  if (!home) {
    return (
      <View style={styles.container} testID="journal-log-screen">
        <Text style={styles.errorText} accessibilityRole="alert" testID="journal-log-unavailable">
          Data unavailable. Please try again later.
        </Text>
      </View>
    );
  }

  return <SymptomJournalLogScreenInner home={home} onBack={onBack} onViewHistory={onViewHistory} />;
}

function SymptomJournalLogScreenInner({
  home,
  onBack,
  onViewHistory,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
  onBack?: () => void;
  onViewHistory?: () => void;
}): React.ReactElement {

  const [symptomType, setSymptomType] = useState('');
  const [systemicLocation, setSystemicLocation] = useState('');
  const [severity, setSeverity] = useState('');
  const [durationValue, setDurationValue] = useState('');
  const [durationUnit, setDurationUnit] = useState<TimeUnit>('hours');
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const journalRef = useRef<SymptomJournal | null>(null);

  const existingSymptoms = usePartition(home, 'symptoms');

  const typeSuggestions = useMemo(
    () => suggestSymptomTypes(existingSymptoms, symptomType),
    [existingSymptoms, symptomType],
  );

  const locationSuggestions = useMemo(
    () => suggestSystemicLocations(existingSymptoms, symptomType, systemicLocation),
    [existingSymptoms, symptomType, systemicLocation],
  );

  const getJournal = useCallback((): SymptomJournal | null => {
    if (!home) return null;
    if (!journalRef.current) {
      journalRef.current = createSymptomJournal(createHomeSymptomStore(home));
    }
    return journalRef.current;
  }, [home]);

  const handleSubmit = useCallback(async () => {
    const journal = getJournal();
    if (!journal) return;

    const matchedType = resolveSymptomTypeMatch(existingSymptoms, symptomType);
    const normalizedType = matchedType ?? normalizeSymptomLabel(symptomType);
    const normalizedLocation = normalizeSymptomLabel(systemicLocation);

    const input: SymptomEntryInput = {
      symptomType: normalizedType,
      systemicLocation: normalizedLocation,
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
        setFieldErrors(result.errors);
        setCommitError(null);
        setSuccessMessage(null);
        return;
      }

      setFieldErrors([]);
      setCommitError(null);
      setSuccessMessage(`Saved ${result.entry.symptomType}.`);

      setSymptomType('');
      setSystemicLocation('');
      setSeverity('');
      setDurationValue('');
      setDurationUnit('hours');
      setNotes('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Symptom was not saved. Please try again.';
      setCommitError(message);
      setSuccessMessage(null);
    }
  }, [
    durationUnit,
    durationValue,
    existingSymptoms,
    getJournal,
    notes,
    severity,
    symptomType,
    systemicLocation,
  ]);

  return (
    <ScrollView style={styles.container} testID="journal-log-screen">
      <Text style={styles.title}>Log Symptom</Text>
      <Text style={styles.lead}>Matching is case-insensitive — pick a suggestion to reuse an existing symptom name.</Text>

      {fieldErrors.length > 0 && (
        <View testID="journal-log-field-errors" accessibilityRole="alert">
          {fieldErrors.map((err, i) => (
            <Text key={`${err.field}-${i}`} style={styles.errorText} testID={`field-error-${err.field}`}>
              {err.field}: {err.message}
            </Text>
          ))}
        </View>
      )}

      {commitError && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="journal-log-commit-error">
          {commitError}
        </Text>
      )}

      {successMessage && (
        <View style={styles.successBox} testID="journal-log-success">
          <Text style={styles.successText}>{successMessage}</Text>
          {onViewHistory && (
            <Pressable
              style={styles.linkButton}
              onPress={onViewHistory}
              accessibilityRole="button"
              testID="journal-log-view-history"
            >
              <Text style={styles.linkButtonText}>View history</Text>
            </Pressable>
          )}
        </View>
      )}

      <Text style={styles.label}>Symptom Type</Text>
      <TextInput
        style={styles.input}
        value={symptomType}
        onChangeText={(value) => {
          setSymptomType(value);
          setSuccessMessage(null);
        }}
        placeholder="e.g. Headache, Joint pain"
        autoCapitalize="words"
        accessibilityLabel="Symptom type"
        testID="journal-log-symptom-type"
      />
      <SuggestionList
        suggestions={typeSuggestions}
        onSelect={(value) => setSymptomType(value)}
        testID="journal-log-type-suggestions"
      />

      <Text style={styles.label}>Systemic Location</Text>
      <TextInput
        style={styles.input}
        value={systemicLocation}
        onChangeText={(value) => {
          setSystemicLocation(value);
          setSuccessMessage(null);
        }}
        placeholder="e.g. Head, Left knee"
        autoCapitalize="words"
        accessibilityLabel="Systemic location"
        testID="journal-log-systemic-location"
      />
      <SuggestionList
        suggestions={locationSuggestions}
        onSelect={(value) => setSystemicLocation(value)}
        testID="journal-log-location-suggestions"
      />

      <Text style={styles.label}>Severity (1–10)</Text>
      <TextInput
        style={styles.input}
        value={severity}
        onChangeText={setSeverity}
        placeholder="1–10"
        keyboardType="number-pad"
        accessibilityLabel="Severity"
        testID="journal-log-severity"
      />

      <Text style={styles.label}>Duration</Text>
      <View style={styles.durationRow}>
        <TextInput
          style={[styles.input, styles.durationInput]}
          value={durationValue}
          onChangeText={setDurationValue}
          placeholder="Value"
          keyboardType="number-pad"
          accessibilityLabel="Duration value"
          testID="journal-log-duration-value"
        />
      </View>
      <View style={styles.unitRow}>
        {DURATION_UNITS.map((unit) => (
          <Pressable
            key={unit}
            style={[styles.unitChip, durationUnit === unit && styles.unitChipSelected]}
            onPress={() => setDurationUnit(unit)}
            accessibilityRole="button"
            accessibilityState={{ selected: durationUnit === unit }}
            testID={`journal-log-duration-unit-${unit}`}
          >
            <Text style={[styles.unitChipText, durationUnit === unit && styles.unitChipTextSelected]}>{unit}</Text>
          </Pressable>
        ))}
      </View>

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

      <Pressable
        style={styles.submitButton}
        onPress={handleSubmit}
        accessibilityRole="button"
        accessibilityLabel="Log symptom"
        testID="journal-log-submit"
      >
        <Text style={styles.submitText}>Log Symptom</Text>
      </Pressable>

      {onBack && (
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="journal-log-back">
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
  unitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  unitChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fafafa',
  },
  unitChipSelected: {
    borderColor: '#0066cc',
    backgroundColor: '#e8f0fe',
  },
  unitChipText: {
    fontSize: 14,
    color: '#444',
    textTransform: 'capitalize',
  },
  unitChipTextSelected: {
    color: '#0066cc',
    fontWeight: '600',
  },
  suggestionList: {
    marginTop: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#d0e3f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fbff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0e3f5',
  },
  suggestionText: {
    fontSize: 15,
    color: '#0066cc',
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 4,
  },
  successBox: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#eef8f0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b8dfc4',
  },
  successText: {
    color: '#067a36',
    fontSize: 14,
    marginBottom: 8,
  },
  linkButton: {
    alignSelf: 'flex-start',
  },
  linkButtonText: {
    color: '#0066cc',
    fontSize: 14,
    fontWeight: '600',
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
