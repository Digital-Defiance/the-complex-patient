/**
 * Medication adherence history — trailing summary from MedEvent records.
 */

import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { VaultRecord } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import { summarizeAdherenceHistory } from '@complex-patient/medications';
import { useAppHost } from '../../app-host';
import { usePartition } from '../../hooks';

export interface MedicationAdherenceHistoryScreenProps {
  onBack?: () => void;
}

export function MedicationAdherenceHistoryScreen({
  onBack,
}: MedicationAdherenceHistoryScreenProps): React.ReactElement {
  const { home } = useAppHost();
  if (!home) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Data unavailable.</Text>
      </View>
    );
  }

  const records = usePartition<VaultRecord>(home, 'medications');
  const { medEvents } = useMemo(() => splitMedicationsPartition(records), [records]);
  const summary = useMemo(() => summarizeAdherenceHistory({ medEvents }), [medEvents]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        {onBack && (
          <Pressable onPress={onBack} accessibilityRole="button" testID="med-adherence-back">
            <Text style={styles.link}>← Back</Text>
          </Pressable>
        )}
        <Text style={styles.title}>Adherence history</Text>
      </View>
      <Text style={styles.lead}>14-day summary from logged take / skip events.</Text>

      {summary.every((day) => day.scheduledCount === 0) ? (
        <Text style={styles.empty} testID="med-adherence-empty">
          Log doses from Today to build adherence history.
        </Text>
      ) : (
        summary.map((day) => (
          <View key={day.day} style={styles.row} testID={`adherence-day-${day.day}`}>
            <Text style={styles.day}>{day.day.slice(5)}</Text>
            <View style={styles.barWrap}>
              <View style={[styles.barTaken, { flex: Math.max(day.takenCount, 0.1) }]} />
              <View style={[styles.barSkipped, { flex: Math.max(day.skippedCount, 0.05) }]} />
              <View style={[styles.barMissed, { flex: Math.max(day.missedCount, 0.05) }]} />
            </View>
            <Text style={styles.counts}>
              {day.takenCount}T · {day.skippedCount}S · {day.missedCount}M
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a', flex: 1 },
  lead: { fontSize: 14, color: '#555', marginBottom: 12 },
  link: { fontSize: 16, color: '#2563eb' },
  empty: { fontSize: 15, color: '#666', textAlign: 'center', marginTop: 32 },
  error: { color: '#c00' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  day: { width: 42, fontSize: 12, color: '#666' },
  barWrap: { flex: 1, flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: '#e2e8f0' },
  barTaken: { backgroundColor: '#16a34a' },
  barSkipped: { backgroundColor: '#ca8a04' },
  barMissed: { backgroundColor: '#94a3b8' },
  counts: { width: 72, fontSize: 11, color: '#555', textAlign: 'right' },
});
