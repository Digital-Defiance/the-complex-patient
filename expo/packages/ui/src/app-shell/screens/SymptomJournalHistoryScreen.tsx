/**
 * @complex-patient/ui — SymptomJournalHistoryScreen
 *
 * Combined symptom + flare journal history with a trailing severity trend chart.
 */

import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import type { FlareUp, LocationTrailSample, SymptomEntry, VaultRecord } from '@complex-patient/domain';
import { filterActive, splitMedicationsPartition } from '@complex-patient/clinical-export';
import { locationPointsForWeather } from '@complex-patient/weather';
import { useAppHost } from '../app-host';
import { usePartition } from '../hooks';
import { useWeatherHost } from '../weather-host-context';
import {
  buildJournalTimeline,
  buildSeverityTrend,
  formatJournalDayLabel,
  groupJournalByDay,
  mergeWeatherIntoTrend,
  trendHasWeatherData,
  weatherOverlayBandHeight,
  weatherOverlayRange,
  weatherOverlayValue,
  WEATHER_OVERLAY_COLORS,
  WEATHER_TREND_OVERLAYS,
  type JournalHistoryEntry,
  type SeverityTrendDayWithWeather,
  type WeatherTrendOverlayId,
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

function SeverityTrendChart({
  trend,
  selectedOverlays,
  onToggleOverlay,
  hasLocationPoints,
  weatherAvailable,
}: {
  trend: SeverityTrendDayWithWeather[];
  selectedOverlays: readonly WeatherTrendOverlayId[];
  onToggleOverlay: (overlayId: WeatherTrendOverlayId) => void;
  hasLocationPoints: boolean;
  weatherAvailable: boolean;
}): React.ReactElement {
  const hasData = trend.some((day) => day.maxSeverity !== null || day.flareCount > 0);

  const overlayRanges = useMemo(() => {
    const ranges = {} as Record<WeatherTrendOverlayId, { min: number; max: number }>;
    for (const overlay of WEATHER_TREND_OVERLAYS) {
      ranges[overlay.id] = weatherOverlayRange(trend, overlay.id);
    }
    return ranges;
  }, [trend]);

  const activeLegend = WEATHER_TREND_OVERLAYS.filter((overlay) =>
    selectedOverlays.includes(overlay.id),
  );

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
        Bars = peak symptom severity · Orange dot = flare-up · Teal triangle = rapid pressure drop
      </Text>

      {hasLocationPoints ? (
        <View style={styles.overlaySection} testID="journal-history-weather-overlays">
          <Text style={styles.overlayLabel}>Weather overlays</Text>
          <View style={styles.overlayChipRow}>
            {WEATHER_TREND_OVERLAYS.map((overlay) => {
              const selected = selectedOverlays.includes(overlay.id);
              return (
                <Pressable
                  key={overlay.id}
                  style={[styles.overlayChip, selected && styles.overlayChipSelected]}
                  onPress={() => onToggleOverlay(overlay.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`journal-history-overlay-${overlay.id}`}
                >
                  <View
                    style={[styles.overlaySwatch, { backgroundColor: WEATHER_OVERLAY_COLORS[overlay.id] }]}
                  />
                  <Text style={styles.overlayChipText}>{overlay.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {!weatherAvailable && (
            <Text style={styles.overlayHint}>Loading weather from your logged locations…</Text>
          )}
          {weatherAvailable && activeLegend.length > 0 && (
            <Text style={styles.overlayLegend}>
              {activeLegend.map((entry) => entry.legend).join(' · ')}
            </Text>
          )}
        </View>
      ) : (
        <Text style={styles.overlayHint} testID="journal-history-weather-unavailable">
          Enable &quot;Attach location&quot; in Settings when logging symptoms, flares, or medications (or the
          mobile location trail) to overlay weather on this chart.
        </Text>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartRow}>
        {trend.map((day) => {
          const barHeight = day.maxSeverity ? (day.maxSeverity / 10) * 72 : 4;
          return (
            <View key={day.day} style={styles.chartColumn} testID={`journal-history-chart-${day.day}`}>
              {day.rapidPressureDrop && (
                <View style={styles.pressureDropMarker} testID={`journal-history-pressure-drop-${day.day}`} />
              )}
              {day.flareCount > 0 && <View style={styles.flareDot} />}
              <View style={[styles.chartBar, { height: barHeight }]} />
              {selectedOverlays.map((overlayId) => {
                const value = weatherOverlayValue(day, overlayId);
                if (value === null) {
                  return null;
                }
                const bandHeight = weatherOverlayBandHeight(
                  value,
                  overlayId,
                  overlayRanges[overlayId],
                );
                const bandColor =
                  overlayId === 'pressureDelta24h' && value > 0
                    ? '#64748b'
                    : WEATHER_OVERLAY_COLORS[overlayId];
                return (
                  <View
                    key={`${day.day}-${overlayId}`}
                    style={[styles.overlayBand, { height: bandHeight, backgroundColor: bandColor }]}
                    testID={`journal-history-overlay-${overlayId}-${day.day}`}
                  />
                );
              })}
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
  const { weather } = useWeatherHost();
  const symptoms = usePartition<SymptomEntry>(home, 'symptoms');
  const flares = usePartition<FlareUp>(home, 'flares');
  const medicationRecords = usePartition<VaultRecord>(home, 'medications');
  const trailSamples = usePartition<LocationTrailSample>(home, 'locationTrail');

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
  const locationPoints = useMemo(() => {
    const { prnLogs } = splitMedicationsPartition(medicationRecords);
    return locationPointsForWeather({
      symptoms,
      flares,
      prnLogs,
      trailSamples,
    });
  }, [flares, medicationRecords, symptoms, trailSamples]);

  const [trendWithWeather, setTrendWithWeather] = useState(() => mergeWeatherIntoTrend(trend, []));
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [selectedOverlays, setSelectedOverlays] = useState<WeatherTrendOverlayId[]>(['pressureDelta24h']);

  const toggleOverlay = useCallback((overlayId: WeatherTrendOverlayId) => {
    setSelectedOverlays((current) =>
      current.includes(overlayId)
        ? current.filter((id) => id !== overlayId)
        : [...current, overlayId],
    );
  }, []);

  useEffect(() => {
    setTrendWithWeather(mergeWeatherIntoTrend(trend, []));
    if (locationPoints.length === 0) {
      return;
    }

    let cancelled = false;
    setWeatherLoading(true);
    void weather
      .loadTrendForPoints(
        trend.map((day) => day.day),
        locationPoints,
      )
      .then((weatherDays) => {
        if (!cancelled) {
          setTrendWithWeather(mergeWeatherIntoTrend(trend, weatherDays));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTrendWithWeather(mergeWeatherIntoTrend(trend, []));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWeatherLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locationPoints, trend, weather]);

  return (
    <View style={styles.container} accessibilityLabel="Journal history">
      <Text style={styles.title}>Journal History</Text>
      <Text style={styles.lead}>
        Symptoms and flare-ups together, grouped by day. Orange markers show flare days on the chart.
      </Text>

      {weatherLoading && (
        <ActivityIndicator
          style={styles.weatherLoading}
          accessibilityLabel="Loading weather overlay"
          testID="journal-history-weather-loading"
        />
      )}

      <SeverityTrendChart
        trend={trendWithWeather}
        selectedOverlays={selectedOverlays}
        onToggleOverlay={toggleOverlay}
        hasLocationPoints={locationPoints.length > 0}
        weatherAvailable={trendHasWeatherData(trendWithWeather)}
      />

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
    minHeight: 110,
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
  pressureDropMarker: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#0d9488',
    marginBottom: 2,
  },
  chartLabel: {
    marginTop: 6,
    fontSize: 10,
    color: '#666',
  },
  overlaySection: {
    marginBottom: 12,
    gap: 8,
  },
  overlayLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  overlayChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  overlayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  overlayChipSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  overlaySwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  overlayChipText: {
    fontSize: 12,
    color: '#334155',
  },
  overlayHint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  overlayLegend: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
  },
  overlayBand: {
    width: 18,
    borderRadius: 2,
    marginTop: 3,
  },
  weatherLoading: {
    marginBottom: 8,
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
