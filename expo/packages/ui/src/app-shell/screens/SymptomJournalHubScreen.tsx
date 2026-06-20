/**
 * @complex-patient/ui — SymptomJournalHubScreen
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { FlareUp, SymptomEntry } from '@complex-patient/domain';
import { filterActive } from '@complex-patient/clinical-export';
import { useAppHost } from '../app-host';
import { usePartition } from '../hooks';

export interface SymptomJournalHubScreenProps {
  onNavigateLog: () => void;
  onNavigateHistory: () => void;
  onNavigateFlare: () => void;
  onBack: () => void;
}

export function SymptomJournalHubScreen({
  onNavigateLog,
  onNavigateHistory,
  onNavigateFlare,
  onBack,
}: SymptomJournalHubScreenProps): React.ReactElement {
  const { home } = useAppHost();

  if (!home) {
    return (
      <View style={styles.container} accessibilityLabel="Symptom journal">
        <Text style={styles.errorText}>Data unavailable. Please try again later.</Text>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button">
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SymptomJournalHubScreenInner
      home={home}
      onNavigateLog={onNavigateLog}
      onNavigateHistory={onNavigateHistory}
      onNavigateFlare={onNavigateFlare}
      onBack={onBack}
    />
  );
}

function SymptomJournalHubScreenInner({
  home,
  onNavigateLog,
  onNavigateHistory,
  onNavigateFlare,
  onBack,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
  onNavigateLog: () => void;
  onNavigateHistory: () => void;
  onNavigateFlare: () => void;
  onBack: () => void;
}): React.ReactElement {
  const symptoms = usePartition<SymptomEntry>(home, 'symptoms');
  const flares = usePartition<FlareUp>(home, 'flares');
  const symptomCount = filterActive(symptoms).length;
  const flareCount = flares.length;

  return (
    <View style={styles.container} accessibilityLabel="Symptom journal">
      <Text style={styles.title}>Symptom Journal</Text>
      <Text style={styles.lead}>
        Log new symptoms, review what you have recorded, or capture a flare-up.
      </Text>

      <Text style={styles.summary} testID="journal-hub-entry-count">
        {symptomCount} symptom entr{symptomCount === 1 ? 'y' : 'ies'}
        {flareCount > 0 ? ` · ${flareCount} flare${flareCount === 1 ? '' : 's'}` : ''} in your vault
      </Text>

      <View style={styles.navContainer}>
        <Pressable
          style={styles.navButton}
          onPress={onNavigateLog}
          accessibilityRole="button"
          accessibilityLabel="Log symptom"
          testID="journal-hub-log"
        >
          <Text style={styles.navButtonText}>Log Symptom</Text>
          <Text style={styles.navButtonSubtext}>Record type, severity, duration, and notes</Text>
        </Pressable>

        <Pressable
          style={styles.navButton}
          onPress={onNavigateHistory}
          accessibilityRole="button"
          accessibilityLabel="View symptom history"
          testID="journal-hub-history"
        >
          <Text style={styles.navButtonText}>View History</Text>
          <Text style={styles.navButtonSubtext}>Symptoms, flare-ups, and a 14-day trend chart</Text>
        </Pressable>

        <Pressable
          style={styles.navButton}
          onPress={onNavigateFlare}
          accessibilityRole="button"
          accessibilityLabel="Log flare-up"
          testID="journal-hub-flare"
        >
          <Text style={styles.navButtonText}>Log Flare-up</Text>
          <Text style={styles.navButtonSubtext}>Group active symptoms with a trigger</Text>
        </Pressable>
      </View>

      <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="journal-hub-back">
        <Text style={styles.backText}>Back</Text>
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
    marginBottom: 12,
    color: '#1a1a1a',
  },
  lead: {
    fontSize: 16,
    color: '#444',
    marginBottom: 16,
    lineHeight: 22,
  },
  summary: {
    fontSize: 14,
    color: '#555',
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
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
  backButton: {
    marginTop: 24,
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
  errorText: {
    color: '#c00',
    marginBottom: 12,
  },
});
