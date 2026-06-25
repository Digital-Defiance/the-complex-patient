/**
 * Medications Today — scheduled dose queue with take / skip / snooze.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { VaultRecord } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import {
  buildTodayQueue,
  recordDoseSkipped,
  recordDoseSnoozed,
  recordDoseTaken,
} from '@complex-patient/medications';
import { MedProductIcon } from '@complex-patient/med-visuals';
import { parseDosageString } from '../../dosage-units';
import { useAppHost } from '../../app-host';
import { usePartition } from '../../hooks';

export interface MedicationsTodayScreenProps {
  onBack?: () => void;
  onPrn?: () => void;
}

export function MedicationsTodayScreen({ onBack, onPrn }: MedicationsTodayScreenProps): React.ReactElement {
  const { home } = useAppHost();
  if (!home) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Data unavailable.</Text>
      </View>
    );
  }
  return <MedicationsTodayInner home={home} onBack={onBack} onPrn={onPrn} />;
}

function MedicationsTodayInner({
  home,
  onBack,
  onPrn,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
  onBack?: () => void;
  onPrn?: () => void;
}): React.ReactElement {
  const records = usePartition<VaultRecord>(home, 'medications');
  const { medications, medEvents } = useMemo(() => splitMedicationsPartition(records), [records]);
  const queue = useMemo(() => buildTodayQueue({ medications, medEvents }), [medications, medEvents]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const mutate = useCallback(
    async (mutator: (current: VaultRecord[]) => VaultRecord[]) => {
      const result = await home.commit<VaultRecord>('medications', mutator);
      if (!result.ok) {
        setError('Change was not saved.');
        return false;
      }
      setError(null);
      return true;
    },
    [home],
  );

  const handleTake = useCallback(
    async (medicationId: string, regimenId: string, scheduledAt: string) => {
      const key = `${medicationId}:${regimenId}:${scheduledAt}`;
      setBusyKey(key);
      await mutate((current) =>
        recordDoseTaken({ current, medicationId, regimenId, scheduledAt }).records,
      );
      setBusyKey(null);
    },
    [mutate],
  );

  const handleSkip = useCallback(
    async (medicationId: string, regimenId: string, scheduledAt: string) => {
      const key = `${medicationId}:${regimenId}:${scheduledAt}`;
      setBusyKey(key);
      await mutate((current) =>
        recordDoseSkipped({ current, medicationId, regimenId, scheduledAt }).records,
      );
      setBusyKey(null);
    },
    [mutate],
  );

  const handleSnooze = useCallback(
    async (medicationId: string, regimenId: string, scheduledAt: string) => {
      const key = `${medicationId}:${regimenId}:${scheduledAt}`;
      setBusyKey(key);
      const snoozedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await mutate((current) =>
        recordDoseSnoozed({ current, medicationId, regimenId, scheduledAt, snoozedUntil }).records,
      );
      setBusyKey(null);
    },
    [mutate],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        {onBack && (
          <Pressable onPress={onBack} accessibilityRole="button" testID="medications-today-back">
            <Text style={styles.link}>← Back</Text>
          </Pressable>
        )}
        <Text style={styles.title}>Today</Text>
      </View>
      <Text style={styles.lead}>{queue.day} · {queue.scheduled.length} scheduled</Text>
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      {queue.scheduled.length === 0 ? (
        <Text style={styles.empty} testID="medications-today-empty">
          No scheduled doses today. Check your cabinet schedules or log a PRN dose.
        </Text>
      ) : (
        queue.scheduled.map((dose) => {
          const med = medications.find((entry) => entry.id === dose.medicationId);
          const regimen = med?.regimens.find((entry) => entry.id === dose.regimenId);
          const key = `${dose.medicationId}:${dose.regimenId}:${dose.scheduledAt}`;
          const busy = busyKey === key;
          return (
            <View key={key} style={styles.doseCard} testID={`today-dose-${dose.medicationId}`}>
              <View style={styles.doseHeader}>
                <MedProductIcon
                  appearance={med?.appearance}
                  form={regimen?.form ?? ''}
                  dosageUnit={regimen ? parseDosageString(regimen.dosage).unit : ''}
                  size={28}
                />
                <View style={styles.doseText}>
                  <Text style={styles.doseName}>
                    {dose.drugName}
                    {dose.regimenLabel ? ` (${dose.regimenLabel})` : ''}
                  </Text>
                  <Text style={styles.doseMeta}>
                    {dose.timeLabel} · {dose.dosageLabel} · {dose.status}
                  </Text>
                </View>
              </View>
              {dose.status === 'due' || dose.status === 'snoozed' || dose.status === 'missed' ? (
                <View style={styles.actions}>
                  <Pressable
                    style={styles.takeBtn}
                    disabled={busy}
                    onPress={() => void handleTake(dose.medicationId, dose.regimenId, dose.scheduledAt)}
                    testID={`today-take-${dose.medicationId}`}
                  >
                    <Text style={styles.takeText}>{busy ? '…' : 'Take'}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryBtn}
                    disabled={busy}
                    onPress={() => void handleSkip(dose.medicationId, dose.regimenId, dose.scheduledAt)}
                    testID={`today-skip-${dose.medicationId}`}
                  >
                    <Text style={styles.secondaryText}>Skip</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryBtn}
                    disabled={busy}
                    onPress={() => void handleSnooze(dose.medicationId, dose.regimenId, dose.scheduledAt)}
                    testID={`today-snooze-${dose.medicationId}`}
                  >
                    <Text style={styles.secondaryText}>Snooze 15m</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}

      {queue.prn.length > 0 && onPrn && (
        <Pressable style={styles.prnLink} onPress={onPrn} testID="medications-today-prn">
          <Text style={styles.link}>{queue.prn.length} PRN medication(s) — open quick log</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a', flex: 1 },
  lead: { fontSize: 14, color: '#555', marginBottom: 4 },
  link: { fontSize: 16, color: '#2563eb' },
  empty: { fontSize: 15, color: '#666', marginTop: 24, textAlign: 'center' },
  error: { color: '#c00', marginBottom: 8 },
  doseCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    gap: 10,
  },
  doseHeader: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  doseText: { flex: 1 },
  doseName: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  doseMeta: { fontSize: 13, color: '#555', marginTop: 2, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  takeBtn: { backgroundColor: '#16a34a', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  takeText: { color: '#fff', fontWeight: '600' },
  secondaryBtn: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  secondaryText: { color: '#334155', fontWeight: '500' },
  prnLink: { marginTop: 12, padding: 12 },
});
