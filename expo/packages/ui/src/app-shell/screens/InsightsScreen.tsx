/**
 * @complex-patient/ui — InsightsScreen
 *
 * Renders medication and weather correlation insight cards from on-device analysis.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import type { FlareUp, LocationTrailSample, SymptomEntry, VaultRecord } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import { locationPointsForWeather } from '@complex-patient/weather';
import {
  detectCorrelations,
  detectWeatherCorrelations,
  createInMemoryVaultDataSource,
  INSUFFICIENT_HISTORY_MESSAGE,
  NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
  WEATHER_INSUFFICIENT_HISTORY_MESSAGE,
  WEATHER_NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
  type CorrelationOutcome,
  type WeatherCorrelationOutcome,
  type AIInsightCard,
} from '@complex-patient/insights';
import { useAppHost } from '../app-host';
import { useWeatherHost } from '../weather-host-context';

export interface InsightsScreenProps {
  onNavigateToReport: () => void;
  onBack: () => void;
}

function InsightCardList({
  cards,
  testIdPrefix,
}: {
  cards: AIInsightCard[];
  testIdPrefix: string;
}): React.ReactElement | null {
  if (cards.length === 0) {
    return null;
  }

  return (
    <View style={styles.cardsContainer} testID={`${testIdPrefix}-cards`}>
      {cards.map((card, index) => (
        <View
          key={`${card.variables[0]}-${card.variables[1]}-${index}`}
          style={styles.card}
          testID={`${testIdPrefix}-card-${index}`}
        >
          <Text style={styles.cardTitle}>
            {card.variables[0]} ↔ {card.variables[1]}
          </Text>
          <Text style={styles.cardDetail}>Direction: {card.direction}</Text>
          <Text style={styles.cardDetail}>
            Lag: {card.lagDays} day{card.lagDays !== 1 ? 's' : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function InsightsScreen({ onNavigateToReport, onBack }: InsightsScreenProps): React.ReactElement {
  const { home } = useAppHost();
  const { weather } = useWeatherHost();

  const [medOutcome, setMedOutcome] = useState<CorrelationOutcome | null>(null);
  const [weatherOutcome, setWeatherOutcome] = useState<WeatherCorrelationOutcome | null>(null);
  const [dataUnavailable, setDataUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!home) {
      setDataUnavailable(true);
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const symptoms = home.read<SymptomEntry>('symptoms');
        const flares = home.read<FlareUp>('flares');
        const medications = home.read('medications');
        const trailSamples = home.read<LocationTrailSample>('locationTrail');
        const split = splitMedicationsPartition(medications.records);

        const medResult = detectCorrelations(
          createInMemoryVaultDataSource({
            symptoms: symptoms.records,
            prnLogs: split.prnLogs,
            medEvents: split.medEvents,
          }),
        );

        const locationPoints = locationPointsForWeather({
          symptoms: symptoms.records,
          flares: flares.records,
          prnLogs: split.prnLogs,
          trailSamples: trailSamples.records,
        });

        let weatherResult: WeatherCorrelationOutcome = {
          status: 'insufficient-data',
          message: WEATHER_INSUFFICIENT_HISTORY_MESSAGE,
          trackingDays: 0,
          pairedObservations: 0,
        };

        if (locationPoints.length > 0) {
          const days: string[] = [];
          const now = new Date();
          for (let offset = 29; offset >= 0; offset -= 1) {
            const date = new Date(now);
            date.setUTCDate(date.getUTCDate() - offset);
            days.push(date.toISOString().slice(0, 10));
          }
          const weatherDays = await weather.loadTrendForPoints(days, locationPoints);
          weatherResult = detectWeatherCorrelations(symptoms.records, weatherDays);
        }

        if (!cancelled) {
          setMedOutcome(medResult);
          setWeatherOutcome(weatherResult);
          setDataUnavailable(false);
        }
      } catch {
        if (!cancelled) {
          setMedOutcome(null);
          setWeatherOutcome(null);
          setDataUnavailable(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [home, weather]);

  if (loading) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
        <ActivityIndicator size="large" testID="insights-loading" />
      </View>
    );
  }

  if (dataUnavailable) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.errorText} accessibilityRole="alert" testID="insights-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="insights-back">
          <Text style={styles.backButtonText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  const medCards = medOutcome?.status === 'ok' ? medOutcome.cards : [];
  const weatherCards = weatherOutcome?.status === 'ok' ? weatherOutcome.cards : [];
  const hasAnyCards = medCards.length > 0 || weatherCards.length > 0;

  if (!hasAnyCards) {
    const medMessage =
      medOutcome?.status === 'insufficient-data'
        ? INSUFFICIENT_HISTORY_MESSAGE
        : medOutcome?.status === 'no-significant-correlations'
          ? NO_SIGNIFICANT_CORRELATIONS_MESSAGE
          : null;
    const weatherMessage =
      weatherOutcome?.status === 'insufficient-data'
        ? WEATHER_INSUFFICIENT_HISTORY_MESSAGE
        : weatherOutcome?.status === 'no-significant-correlations'
          ? WEATHER_NO_SIGNIFICANT_CORRELATIONS_MESSAGE
          : null;

    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
        <Text style={styles.title}>Insights</Text>
        {medMessage && (
          <Text style={styles.messageText} testID="insights-med-message">
            {medMessage}
          </Text>
        )}
        {weatherMessage && (
          <Text style={styles.messageText} testID="insights-weather-message">
            {weatherMessage}
          </Text>
        )}
        <Pressable
          style={styles.reportButton}
          onPress={onNavigateToReport}
          accessibilityRole="button"
          testID="insights-generate-report"
        >
          <Text style={styles.reportButtonText}>Generate Physician Report</Text>
        </Pressable>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="insights-back">
          <Text style={styles.backButtonText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
      <Text style={styles.title}>Insights</Text>

      {medCards.length > 0 && (
        <>
          <Text style={styles.subtitle}>Medication correlations</Text>
          <InsightCardList cards={medCards} testIdPrefix="insights-med" />
        </>
      )}

      {weatherCards.length > 0 && (
        <>
          <Text style={styles.subtitle}>Weather correlations</Text>
          <InsightCardList cards={weatherCards} testIdPrefix="insights-weather" />
        </>
      )}

      <Pressable
        style={styles.reportButton}
        onPress={onNavigateToReport}
        accessibilityRole="button"
        testID="insights-generate-report"
      >
        <Text style={styles.reportButtonText}>Generate Physician Report</Text>
      </Pressable>
      <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="insights-back">
        <Text style={styles.backButtonText}>Back to Home</Text>
      </Pressable>
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
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 12,
    marginTop: 8,
  },
  errorText: {
    color: '#c00',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  messageText: {
    color: '#555',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  cardsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  card: {
    padding: 16,
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0e3f5',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0066cc',
    marginBottom: 8,
  },
  cardDetail: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  reportButton: {
    padding: 16,
    backgroundColor: '#0066cc',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  reportButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  backButton: {
    padding: 16,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 24,
  },
  backButtonText: {
    fontSize: 16,
    color: '#555',
  },
});
