/**
 * @complex-patient/ui — SymptomJournalHistoryScreen
 *
 * Combined symptom + flare journal history with a trailing severity trend chart.
 */

import React, { useMemo } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, ScrollView } from 'react-native';
import type { FlareUp, SymptomEntry } from '@complex-patient/domain';
import { filterActive } from '@complex-patient/clinical-export';
import { useAppHost } from '../app-host';
import { usePartition } from '../hooks';
import {
  buildJournalTimeline,
  buildSeverityTrend,
  formatJournalDayLabel,
  groupJournalByDay,
  type JournalHistoryEntry,
  type SeverityTrendDay,
} from '../symptom-journal-ui';

export interface SymptomJournalHistoryScreenProps {
  onBack: () => void;
  onLogSymptom?: () => void;
}

function formatSymptomSummary(entry: SymptomEntry): string {
  const parts = [
    entry.systemicLocation,
    `Severity ${entry.severity}/10`,
    `${entry.duration.value} ${entry.duration.unit}`,
  ];
  if (entry.notes.trim()) {
    parts.push(entry.notes.trim());
  }
  return parts.join(' · ');
}

function formatFlareSummary(entry: JournalHistoryEntry & { kind: 'flare' }): string {
  const trigger = entry.record.trigger.trim();
  const symptoms = entry.symptomLabels.join(', ');
  return trigger ? `${symptoms} · Trigger: ${trigger}` : symptoms;
}

function SeverityTrendChart({ trend }: { trend: SeverityTrendDay[] }): React.ReactElement {
  const hasData = trend.some((day) => day.maxSeverity !== null || day.flareCount > 0);

  if (!hasData) {
    return (
      <Text style={styles.chartEmpty} testID="journal-history-chart-empty">
        Log symptoms or flares to see your 14-day trend.
      </Text>
    );
  }

  return (
    <View style={styles.chartWrap} testID="journal-history-chart">
      <Text style={styles.chartTitle}>14-day severity trend</Text>
      <Text style={styles.chartLegend}>
        Bars = peak symptom severity · Orange dot = flare-up
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartRow}>
        {trend.map((day) => {
          const barHeight = day.maxSeverity ? (day.maxSeverity / 10) * 72 : 4;
          return (
            <View key={day.day} style={styles.chartColumn} testID={`journal-history-chart-${day.day}`}>
              {day.flareCount > 0 && <View style={styles.flareDot} />}
              <View style={[styles.chartBar, { height: barHeight }]} />
              <Text style={styles.chartLabel}>{day.day.slice(8)}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function HistoryEntryRow({ entry }: { entry: JournalHistoryEntry }): React.ReactElement {
  if (entry.kind === 'flare') {
    return (
      <View style={[styles.entryRow, styles.flareRow]} testID={`journal-history-flare-${entry.id}`}>
        <View style={styles.kindBadgeFlare}>
          <Text style={styles.kindBadgeText}>Flare</Text>
        </View>
        <Text style={styles.entryTitle}>Flare-up ({entry.record.symptomIds.length} symptoms)</Text>
        <Text style={styles.entryMeta}>{entry.op_timestamp}</Text>
        <Text style={styles.entrySummary}>{formatFlareSummary(entry)}</Text>
      </View>
    );
  }

  const symptom = entry.record;
  return (
    <View style={styles.entryRow} testID={`journal-history-entry-${entry.id}`}>
      <View style={styles.kindBadgeSymptom}>
        <Text style={styles.kindBadgeText}>Symptom</Text>
      </View>
      <Text style={styles.entryTitle}>{symptom.symptomType}</Text>
      <Text style={styles.entryMeta}>{entry.op_timestamp}</Text>
      <Text style={styles.entrySummary}>{formatSymptomSummary(symptom)}</Text>
      {!symptom.active && <Text style={styles.inactiveBadge}>Inactive</Text>}
    </View>
  );
}

export function SymptomJournalHistoryScreen({
  onBack,
  onLogSymptom,
}: SymptomJournalHistoryScreenProps): React.ReactElement {
  const { home } = useAppHost();

  if (!home) {
    return (
      <View style={styles.container} accessibilityLabel="Journal history">
        <Text style={styles.errorText} accessibilityRole="alert" testID="journal-history-unavailable">
          Data unavailable. Please try again later.
        </Text>
        <Pressable style={styles.secondaryButton} onPress={onBack} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SymptomJournalHistoryScreenInner onBack={onBack} onLogSymptom={onLogSymptom} home={home} />
  );
}

function SymptomJournalHistoryScreenInner({
  home,
  onBack,
  onLogSymptom,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
  onBack: () => void;
  onLogSymptom?: () => void;
}): React.ReactElement {
  const symptoms = usePartition<SymptomEntry>(home, 'symptoms');
  const flares = usePartition<FlareUp>(home, 'flares');

  const timeline = useMemo(
    () => buildJournalTimeline(filterActive(symptoms), flares),
    [symptoms, flares],
  );

  const sections = useMemo(
    () =>
      groupJournalByDay(timeline).map((group) => ({
        title: formatJournalDayLabel(group.day),
        dayKey: group.day,
        data: group.entries,
      })),
    [timeline],
  );

  const trend = useMemo(() => buildSeverityTrend(timeline), [timeline]);

  return (
    <View style={styles.container} accessibilityLabel="Journal history">
      <Text style={styles.title}>Journal History</Text>
      <Text style={styles.lead}>
        Symptoms and flare-ups together, grouped by day. Orange markers show flare days on the chart.
      </Text>

      <SeverityTrendChart trend={trend} />

      {timeline.length === 0 ? (
        <View style={styles.emptyBox} testID="journal-history-empty">
          <Text style={styles.emptyText}>No journal entries yet.</Text>
          {onLogSymptom && (
            <Pressable
              style={styles.primaryButton}
              onPress={onLogSymptom}
              accessibilityRole="button"
              testID="journal-history-log-first"
            >
              <Text style={styles.primaryButtonText}>Log your first symptom</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader} testID={`journal-history-day-${section.dayKey}`}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => <HistoryEntryRow entry={item} />}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          testID="journal-history-list"
        />
      )}

      <Pressable
        style={styles.secondaryButton}
        onPress={onBack}
        accessibilityRole="button"
        testID="journal-history-back"
      >
        <Text style={styles.secondaryButtonText}>Back</Text>
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
    marginBottom: 8,
    color: '#1a1a1a',
  },
  lead: {
    fontSize: 16,
    color: '#444',
    marginBottom: 16,
    lineHeight: 22,
  },
  chartWrap: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  chartLegend: {
    fontSize: 12,
    color: '#666',
    marginBottom: 12,
  },
  chartEmpty: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  chartRow: {
    alignItems: 'flex-end',
    gap: 8,
    paddingBottom: 4,
  },
  chartColumn: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 96,
  },
  chartBar: {
    width: 18,
    backgroundColor: '#0066cc',
    borderRadius: 4,
    marginTop: 4,
  },
  flareDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d97706',
    marginBottom: 2,
  },
  chartLabel: {
    marginTop: 6,
    fontSize: 10,
    color: '#666',
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#fff',
  },
  listContent: {
    paddingBottom: 8,
  },
  emptyBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  entryRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  flareRow: {
    backgroundColor: '#fffaf0',
  },
  kindBadgeSymptom: {
    alignSelf: 'flex-start',
    backgroundColor: '#e8f1fb',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 6,
  },
  kindBadgeFlare: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffedd5',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 6,
  },
  kindBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
  },
  entryTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  entryMeta: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  entrySummary: {
    fontSize: 14,
    color: '#444',
    lineHeight: 20,
  },
  inactiveBadge: {
    marginTop: 6,
    fontSize: 12,
    color: '#8a5a00',
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 16,
  },
  errorText: {
    color: '#c00',
    marginBottom: 12,
  },
});
