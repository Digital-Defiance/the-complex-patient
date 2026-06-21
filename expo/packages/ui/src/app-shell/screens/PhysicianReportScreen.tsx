/**
 * @complex-patient/ui — PhysicianReportScreen
 *
 * Generates the physician report on-device through the Insights_Engine report
 * path without transmitting report-source PHI to the Sync_Backend. On failure,
 * shows a report-generation-failure message and stays on the insights screen
 * (navigates back).
 *
 * Computes reports only from `home.read` data (Requirement 11.6). Does NOT
 * transmit report-source PHI during generation (Requirement 11.4).
 *
 * Requirements: 11.4, 11.5, 11.6
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useAppHost } from '../app-host';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import {
  generatePhysicianReport,
  createInMemoryReportDataSource,
  REPORT_FAILED_MESSAGE,
  type PhysicianReport,
  type PhysicianReportRenderer,
} from '@complex-patient/insights';

/**
 * Props for the PhysicianReportScreen.
 */
export interface PhysicianReportScreenProps {
  /** Navigate back to insights on failure or completion. */
  onBack: () => void;
}

/**
 * A simple on-device text renderer (no network I/O). The generated "document"
 * is a plain text representation. A real implementation would produce a PDF
 * using an on-device library.
 */
const textRenderer: PhysicianReportRenderer<string> = {
  render(report: PhysicianReport): string {
    const lines: string[] = [
      `Physician Report — Generated ${report.generatedAt}`,
      '',
    ];
    for (const section of report.sections) {
      lines.push(`## ${section.title}`);
      if (section.empty) {
        lines.push('  No data available.');
      } else {
        for (const line of section.lines) {
          lines.push(`  ${line}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  },
};

export function PhysicianReportScreen({ onBack }: PhysicianReportScreenProps): React.ReactElement {
  const { home } = useAppHost();

  const [report, setReport] = useState<PhysicianReport | null>(null);
  const [reportDocument, setReportDocument] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Generate the report on-device from home.read data only (Requirements 11.4, 11.6).
  useEffect(() => {
    if (!home) {
      setError(REPORT_FAILED_MESSAGE);
      setLoading(false);
      return;
    }

    try {
      // Read data exclusively through home.read (Requirement 11.6, 14.1).
      const symptoms = home.read('symptoms');
      const medications = home.read('medications');
      const split = splitMedicationsPartition(medications.records);

      const dataSource = createInMemoryReportDataSource({
        medications: split.medications,
        symptoms: symptoms.records,
        prnLogs: split.prnLogs,
        medEvents: split.medEvents,
      });

      // Generate on-device, no PHI transmitted (Requirement 11.4).
      const result = generatePhysicianReport(dataSource, textRenderer);

      if (result.status === 'ok') {
        setReport(result.report);
        setReportDocument(result.document);
        setError(null);
      } else {
        // Requirement 11.5: show report-generation-failure message.
        setReport(null);
        setReportDocument(null);
        setError(result.message);
      }
    } catch {
      // Requirement 11.5: report generation failed → failure message, stay on insights.
      setReport(null);
      setReportDocument(null);
      setError(REPORT_FAILED_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, [home]);

  // Loading state.
  if (loading) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Physician Report">
        <ActivityIndicator size="large" testID="report-loading" />
      </View>
    );
  }

  // Requirement 11.5: on failure, show error message and provide back navigation.
  if (error) {
    return (
      <View style={styles.container} accessibilityRole="none" accessibilityLabel="Physician Report">
        <Text style={styles.title}>Physician Report</Text>
        <Text style={styles.errorText} accessibilityRole="alert" testID="report-generation-failure">
          {error}
        </Text>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="report-back">
          <Text style={styles.backButtonText}>Back to Insights</Text>
        </Pressable>
      </View>
    );
  }

  // Success: show generated report.
  return (
    <ScrollView style={styles.container} accessibilityRole="none" accessibilityLabel="Physician Report">
      <Text style={styles.title}>Physician Report</Text>

      {report && (
        <View testID="report-content">
          <Text style={styles.generatedAt}>
            Generated: {new Date(report.generatedAt).toLocaleString()}
          </Text>

          {report.sections.map((section, index) => (
            <View key={`${section.title}-${index}`} style={styles.section} testID={`report-section-${index}`}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.empty ? (
                <Text style={styles.sectionEmpty}>No data available.</Text>
              ) : (
                section.lines.map((line, lineIndex) => (
                  <Text key={`${section.title}-line-${lineIndex}`} style={styles.sectionLine}>
                    {line}
                  </Text>
                ))
              )}
            </View>
          ))}
        </View>
      )}

      {reportDocument && (
        <View style={styles.documentContainer} testID="report-document">
          <Text style={styles.documentLabel}>Report Document (Text)</Text>
          <Text style={styles.documentText}>{reportDocument}</Text>
        </View>
      )}

      <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="report-back">
        <Text style={styles.backButtonText}>Back to Insights</Text>
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
  generatedAt: {
    fontSize: 14,
    color: '#777',
    marginBottom: 20,
  },
  errorText: {
    color: '#c00',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  section: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  sectionEmpty: {
    fontSize: 14,
    color: '#888',
    fontStyle: 'italic',
  },
  sectionLine: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  documentContainer: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#f0f7ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0e3f5',
    marginBottom: 24,
  },
  documentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0066cc',
    marginBottom: 8,
  },
  documentText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
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
