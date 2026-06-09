/**
 * @complex-patient/ui — InsightsScreen
 *
 * Renders AI insight cards from the Insights_Engine correlation detection.
 * Handles four states:
 * 1. Data unavailable (home.read fails) → data-unavailable message, no cards.
 * 2. Insufficient history → insufficient-history message, no cards.
 * 3. Zero correlations without insufficiency → no-correlations-found message.
 * 4. OK → render correlation insight cards.
 *
 * Computes cards only from `home.read` data (Requirement 11.6). Blocks
 * insights with a data-unavailable message when the data source is unavailable
 * (Requirement 11.7).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.6, 11.7
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useAppHost } from '../app-host';
import {
  detectCorrelations,
  createInMemoryVaultDataSource,
  INSUFFICIENT_HISTORY_MESSAGE,
  NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
  type CorrelationOutcome,
  type AIInsightCard,
} from '@complex-patient/insights';

/**
 * Props for the InsightsScreen. The navigation callback is supplied by the
 * route file so the screen stays decoupled from Expo Router directly.
 */
export interface InsightsScreenProps {
  /** Navigate to the physician report screen. */
  onNavigateToReport: () => void;
  /** Navigate back to home. */
  onBack: () => void;
}

export function InsightsScreen({ onNavigateToReport, onBack }: InsightsScreenProps): React.ReactElement {
  const { home } = useAppHost();

  const [outcome, setOutcome] = useState<CorrelationOutcome | null>(null);
  const [dataUnavailable, setDataUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  // Compute insight cards exclusively from home.read data (Requirement 11.6).
  useEffect(() => {
    if (!home) {
      setDataUnavailable(true);
      setLoading(false);
      return;
    }

    try {
      // Read data through home.read (Requirement 11.6, 14.1).
      const symptoms = home.read('symptoms');
      const medications = home.read('medications');

      // Create in-memory data source from home.read data only.
      const dataSource = createInMemoryVaultDataSource({
        symptoms: symptoms.records,
        prnLogs: medications.records.filter((r: { id: string }) => 'loggedAt' in r) as never[],
        medEvents: medications.records.filter((r: { id: string }) => 'scheduledAt' in r) as never[],
      });

      const result = detectCorrelations(dataSource);
      setOutcome(result);
      setDataUnavailable(false);
    } catch {
      // Requirement 11.7: on read failure, block insights with data-unavailable.
      setOutcome(null);
      setDataUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [home]);

  // Loading state.
  if (loading) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
        <ActivityIndicator size="large" testID="insights-loading" />
      </View>
    );
  }

  // Requirement 11.7: data source unavailable → data-unavailable message.
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

  // Requirement 11.2: insufficient history → insufficient-history message, no cards.
  if (outcome && outcome.status === 'insufficient-data') {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.messageText} accessibilityRole="alert" testID="insights-insufficient-history">
          {INSUFFICIENT_HISTORY_MESSAGE}
        </Text>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="insights-back">
          <Text style={styles.backButtonText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  // Requirement 11.3: zero correlations without insufficiency → no-correlations-found.
  if (outcome && outcome.status === 'no-significant-correlations') {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.messageText} testID="insights-no-correlations">
          {NO_SIGNIFICANT_CORRELATIONS_MESSAGE}
        </Text>
        <Pressable style={styles.reportButton} onPress={onNavigateToReport} accessibilityRole="button" testID="insights-generate-report">
          <Text style={styles.reportButtonText}>Generate Physician Report</Text>
        </Pressable>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="insights-back">
          <Text style={styles.backButtonText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  // Error from correlation detection (analysis failed).
  if (outcome && outcome.status === 'error') {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.errorText} accessibilityRole="alert" testID="insights-data-unavailable">
          {outcome.message}
        </Text>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="insights-back">
          <Text style={styles.backButtonText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  // Requirement 11.1: render AI insight cards.
  const cards: AIInsightCard[] = outcome && outcome.status === 'ok' ? outcome.cards : [];

  return (
    <ScrollView style={styles.container} accessibilityRole="none" accessibilityLabel="Insights">
      <Text style={styles.title}>Insights</Text>
      <Text style={styles.subtitle}>Correlation Analysis</Text>

      <View style={styles.cardsContainer} testID="insights-cards">
        {cards.map((card, index) => (
          <View key={`${card.variables[0]}-${card.variables[1]}-${index}`} style={styles.card} testID={`insight-card-${index}`}>
            <Text style={styles.cardTitle}>
              {card.variables[0]} ↔ {card.variables[1]}
            </Text>
            <Text style={styles.cardDetail}>
              Direction: {card.direction}
            </Text>
            <Text style={styles.cardDetail}>
              Lag: {card.lagDays} day{card.lagDays !== 1 ? 's' : ''}
            </Text>
          </View>
        ))}
      </View>

      <Pressable style={styles.reportButton} onPress={onNavigateToReport} accessibilityRole="button" testID="insights-generate-report">
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
    marginBottom: 20,
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
