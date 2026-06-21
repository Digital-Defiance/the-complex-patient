/**
 * Medications hub — entry to Today, Cabinet, History, and PRN log.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';

export interface MedicationsHubScreenProps {
  onToday: () => void;
  onCabinet: () => void;
  onHistory: () => void;
  onPrn: () => void;
  onAdd: () => void;
  onBack?: () => void;
}

export function MedicationsHubScreen({
  onToday,
  onCabinet,
  onHistory,
  onPrn,
  onAdd,
  onBack,
}: MedicationsHubScreenProps): React.ReactElement {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        {onBack && (
          <Pressable onPress={onBack} accessibilityRole="button" testID="medications-hub-back">
            <Text style={styles.link}>← Back</Text>
          </Pressable>
        )}
        <Text style={styles.title}>Medications</Text>
      </View>

      <Pressable style={styles.primaryCard} onPress={onToday} accessibilityRole="button" testID="medications-nav-today">
        <Text style={styles.primaryTitle}>Today</Text>
        <Text style={styles.primarySub}>Scheduled doses · take · skip · snooze</Text>
      </Pressable>

      <Pressable style={styles.card} onPress={onCabinet} accessibilityRole="button" testID="medications-nav-cabinet">
        <Text style={styles.cardTitle}>Cabinet</Text>
        <Text style={styles.cardSub}>All medications, schedules, and refill tracking</Text>
      </Pressable>

      <Pressable style={styles.card} onPress={onHistory} accessibilityRole="button" testID="medications-nav-history">
        <Text style={styles.cardTitle}>Adherence history</Text>
        <Text style={styles.cardSub}>14-day taken / skipped / missed summary</Text>
      </Pressable>

      <Pressable style={styles.card} onPress={onPrn} accessibilityRole="button" testID="medications-nav-prn">
        <Text style={styles.cardTitle}>PRN quick log</Text>
        <Text style={styles.cardSub}>One-tap as-needed doses with safety limits</Text>
      </Pressable>

      <Pressable style={styles.addButton} onPress={onAdd} accessibilityRole="button" testID="medications-add">
        <Text style={styles.addButtonText}>Add medication</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a', flex: 1 },
  link: { fontSize: 16, color: '#2563eb' },
  primaryCard: {
    padding: 20,
    borderRadius: 14,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  primaryTitle: { fontSize: 20, fontWeight: '700', color: '#1d4ed8', marginBottom: 4 },
  primarySub: { fontSize: 14, color: '#334155' },
  card: {
    padding: 18,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  cardSub: { fontSize: 14, color: '#555' },
  addButton: {
    marginTop: 8,
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
