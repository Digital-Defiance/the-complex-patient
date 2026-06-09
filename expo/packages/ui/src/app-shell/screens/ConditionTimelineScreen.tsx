/**
 * @complex-patient/ui — ConditionTimelineScreen
 *
 * Read-only screen rendering the per-condition timeline produced by
 * `buildConditionTimeline(...)`. Entries are displayed ordered from oldest to
 * newest (Requirement 10.3). When zero entries are returned, an empty-timeline
 * message is rendered with no timeline entry rows (Requirement 10.4).
 *
 * Data is read exclusively through `home.read(...)` — the screen performs no
 * writes and no direct vault access.
 *
 * Requirements: 10.3, 10.4
 */

import React, { useMemo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import {
  buildConditionTimeline,
  type TimelineEntry,
  type ConditionTimeline,
} from '@complex-patient/symptom-journal';
import type {
  SymptomEntry,
  MedicationProfile,
  FlareUp,
  Association,
} from '@complex-patient/domain';
import { useAppHost } from '../app-host';

/**
 * Props for the ConditionTimelineScreen. The conditionId is supplied by the
 * route file (extracted from route params).
 */
export interface ConditionTimelineScreenProps {
  /** The id of the condition whose timeline to display. */
  conditionId: string;
}

/**
 * Renders a single timeline entry row showing the kind, timestamp, and a
 * summary of the record.
 */
function TimelineEntryRow({ item }: { item: TimelineEntry }): React.ReactElement {
  const label = item.kind === 'symptom'
    ? (item.record as SymptomEntry).symptomType
    : item.kind === 'medication'
      ? (item.record as MedicationProfile).drugName
      : `Flare (${(item.record as FlareUp).symptomIds.length} symptoms)`;

  return (
    <View style={styles.entryRow} testID={`timeline-entry-${item.id}`} accessibilityRole="none">
      <View style={styles.entryKindBadge}>
        <Text style={styles.entryKindText}>{item.kind}</Text>
      </View>
      <View style={styles.entryContent}>
        <Text style={styles.entryLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.entryTimestamp}>{item.op_timestamp}</Text>
      </View>
    </View>
  );
}

export function ConditionTimelineScreen({ conditionId }: ConditionTimelineScreenProps): React.ReactElement {
  const { home } = useAppHost();

  const timeline: ConditionTimeline | null = useMemo(() => {
    if (!home) return null;

    try {
      const symptoms = home.read<SymptomEntry>('symptoms').records;
      const medications = home.read<MedicationProfile>('medications').records;
      const flares = home.read<FlareUp>('flares').records;
      const associations = home.read<Association>('associations').records;

      const result = buildConditionTimeline(conditionId, symptoms, medications, flares, associations);

      // Requirement 10.3: entries ordered oldest-to-newest.
      // buildConditionTimeline returns descending (most-recent-first), so reverse.
      return {
        ...result,
        entries: [...result.entries].reverse(),
      };
    } catch {
      return null;
    }
  }, [home, conditionId]);

  // If home is not available, show data-unavailable.
  if (!home || timeline === null) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Condition Timeline">
        <Text style={styles.errorText} accessibilityRole="alert" testID="timeline-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
      </View>
    );
  }

  // Requirement 10.4: empty-timeline message when zero entries.
  if (timeline.isEmpty) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Condition Timeline">
        <Text style={styles.title}>Condition Timeline</Text>
        <Text style={styles.emptyMessage} testID="timeline-empty">
          No timeline entries for this condition yet.
        </Text>
      </View>
    );
  }

  // Requirement 10.3: render entries oldest-to-newest.
  return (
    <View style={styles.container} accessibilityRole="none" accessibilityLabel="Condition Timeline">
      <Text style={styles.title}>Condition Timeline</Text>
      <FlatList<TimelineEntry>
        data={timeline.entries}
        keyExtractor={(item: TimelineEntry) => item.id}
        renderItem={({ item }: { item: TimelineEntry }) => <TimelineEntryRow item={item} />}
        testID="timeline-list"
      />
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
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
    color: '#1a1a1a',
  },
  emptyMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 48,
  },
  errorText: {
    color: '#c00',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  entryKindBadge: {
    backgroundColor: '#e8f0fe',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
    minWidth: 80,
    alignItems: 'center',
  },
  entryKindText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a73e8',
    textTransform: 'capitalize',
  },
  entryContent: {
    flex: 1,
  },
  entryLabel: {
    fontSize: 15,
    color: '#333',
    marginBottom: 2,
  },
  entryTimestamp: {
    fontSize: 12,
    color: '#888',
  },
});
