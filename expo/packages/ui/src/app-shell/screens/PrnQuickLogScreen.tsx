/**
 * @complex-patient/ui — PrnQuickLogScreen
 *
 * PRN quick-log screen that routes entries exclusively through the
 * PrnQuickLogEngine path. Renders the PrnQuickLogEvaluation outcome including
 * any safety-threshold-exceeded result before accepting another entry. Persists
 * through home.commit('medications', …) and retains values on commit failure.
 *
 * Requirements: 9.4, 9.5, 9.6, 9.7
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { MedicationProfile, PrnLog, PrnConfig, VaultRecord } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import { captureLogLocation } from '@complex-patient/weather';
import {
  evaluatePrnQuickLog,
  computeTrailing24hCumulative,
  type PrnQuickLogEvaluation,
} from '@complex-patient/medications';
import { useAppHost } from '../app-host';
import { usePartition } from '../hooks';
import { useWeatherHost } from '../weather-host-context';
import type { HomeEntryController } from '../../app/home-entry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a UUID for new PRN log records (mirrors the engine's own factory). */
function generateId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrnQuickLogScreenProps {
  /** Navigate back to the medications list. */
  onBack?: () => void;
}

/**
 * Internal state for a single PRN quick-log attempt. Captures the evaluation
 * result so it can be displayed before accepting another entry.
 */
interface LogAttemptState {
  medicationId: string;
  drugName: string;
  evaluation: PrnQuickLogEvaluation;
  prn: PrnConfig;
  /** Whether persistence succeeded. */
  persisted: boolean;
  /** Persistence failure message (Requirement 9.7). */
  persistError: string | null;
  /** Whether this was an override-acknowledged log. */
  overrideAcknowledged: boolean;
}

// ---------------------------------------------------------------------------
// Outer Screen Component — handles the null home case
// ---------------------------------------------------------------------------

/**
 * PRN Quick Log screen.
 *
 * - Reads PRN-configured medications from home.read('medications') (Req 9.4).
 * - Routes entries exclusively through evaluatePrnQuickLog (Req 9.4).
 * - Displays the evaluation outcome including safety threshold (Req 9.5).
 * - Persists through home.commit (Req 9.6).
 * - Retains values on commit failure (Req 9.7).
 */
export function PrnQuickLogScreen({ onBack }: PrnQuickLogScreenProps): React.ReactElement {
  const { home } = useAppHost();

  // If home is not available, render the data-unavailable fallback.
  if (!home) {
    return (
      <View style={styles.container} testID="prn-quick-log-screen">
        <Text style={styles.errorText} accessibilityRole="alert" testID="prn-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
        {onBack && (
          <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="prn-back">
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return <PrnQuickLogScreenInner home={home} onBack={onBack} />;
}

// ---------------------------------------------------------------------------
// Inner component — safe to call hooks unconditionally since home is guaranteed.
// ---------------------------------------------------------------------------

interface InnerProps {
  home: HomeEntryController;
  onBack?: () => void;
}

function PrnQuickLogScreenInner({ home, onBack }: InnerProps): React.ReactElement {
  const { location, preferences } = useWeatherHost();
  const allRecords = usePartition<VaultRecord>(home, 'medications');
  const { medications, prnLogs } = useMemo(
    () => splitMedicationsPartition(allRecords),
    [allRecords],
  );
  const prnMedications = medications.filter(
    (m) => m.prn !== undefined && m.active === true && m.deleted !== true,
  );

  // The last log attempt result (evaluation) displayed before accepting another.
  const [lastAttempt, setLastAttempt] = useState<LogAttemptState | null>(null);
  // Whether a log operation is in progress.
  const [isLogging, setIsLogging] = useState(false);

  /**
   * Execute a PRN quick-log for a medication. Routes exclusively through
   * evaluatePrnQuickLog — no other regimen mutation (Requirement 9.4).
   */
  const handleQuickLog = useCallback(
    async (medication: MedicationProfile, overrideAcknowledged = false) => {
      if (!medication.prn) return;

      const prn = medication.prn;
      const nowMs = Date.now();
      const takenAt = new Date(nowMs).toISOString();

      // Compute trailing 24h cumulative from current logs.
      const existingCumulative = computeTrailing24hCumulative(
        prnLogs,
        medication.id,
        nowMs,
      );

      // Route through evaluatePrnQuickLog exclusively (Requirement 9.4).
      const evaluation = evaluatePrnQuickLog({
        existingCumulative,
        doseAmount: prn.doseAmount,
        safetyLimit24h: prn.safetyLimit24h,
        overrideAcknowledged,
      });

      // If blocked (safety threshold exceeded), display evaluation and wait
      // for the user to either override or cancel (Requirement 9.5).
      if (evaluation.blocked) {
        setLastAttempt({
          medicationId: medication.id,
          drugName: medication.drugName,
          evaluation,
          prn,
          persisted: false,
          persistError: null,
          overrideAcknowledged: false,
        });
        return;
      }

      // Evaluation says to record — persist through home.commit (Requirement 9.6).
      setIsLogging(true);

      const newLog: PrnLog = {
        id: generateId(),
        op_timestamp: takenAt,
        medicationId: medication.id,
        amount: prn.doseAmount,
        takenAt,
        ...(evaluation.overrideFlag ? { override: true } : {}),
      };

      const logLocation = await captureLogLocation({
        preferences,
        location,
        capturedAt: takenAt,
      });
      if (logLocation) {
        newLog.location = logLocation;
      }

      try {
        const result = await home.commit<VaultRecord>(
          'medications',
          (current) => [...current, newLog],
        );

        if (result.ok) {
          setLastAttempt({
            medicationId: medication.id,
            drugName: medication.drugName,
            evaluation,
            prn,
            persisted: true,
            persistError: null,
            overrideAcknowledged,
          });
        } else {
          // Commit failure — retain values, show error (Requirement 9.7).
          setLastAttempt({
            medicationId: medication.id,
            drugName: medication.drugName,
            evaluation,
            prn,
            persisted: false,
            persistError: result.message,
            overrideAcknowledged,
          });
        }
      } catch {
        // Unexpected commit failure — retain values (Requirement 9.7).
        setLastAttempt({
          medicationId: medication.id,
          drugName: medication.drugName,
          evaluation,
          prn,
          persisted: false,
          persistError: 'Change was not saved.',
          overrideAcknowledged,
        });
      } finally {
        setIsLogging(false);
      }
    },
    [home, location, preferences, prnLogs],
  );

  /**
   * Handle override acknowledgement when a safety threshold is exceeded.
   * Re-runs the quick log with overrideAcknowledged = true.
   */
  const handleOverride = useCallback(() => {
    if (!lastAttempt) return;
    const medication = prnMedications.find((m) => m.id === lastAttempt.medicationId);
    if (medication) {
      void handleQuickLog(medication, true);
    }
  }, [lastAttempt, prnMedications, handleQuickLog]);

  /** Dismiss the last evaluation result and allow another entry. */
  const handleDismiss = useCallback(() => {
    setLastAttempt(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // When a lastAttempt exists, display the evaluation outcome before accepting
  // another entry (Requirement 9.5).
  if (lastAttempt) {
    return (
      <View style={styles.container} testID="prn-quick-log-screen">
        <Text style={styles.title}>PRN Quick Log</Text>
        <PrnEvaluationDisplay
          attempt={lastAttempt}
          onOverride={handleOverride}
          onDismiss={handleDismiss}
          isLogging={isLogging}
        />
        {onBack && (
          <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="prn-back">
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // No PRN medications available.
  if (prnMedications.length === 0) {
    return (
      <View style={styles.container} testID="prn-quick-log-screen">
        <Text style={styles.title}>PRN Quick Log</Text>
        <Text style={styles.emptyText} testID="prn-no-medications">
          No PRN medications configured.
        </Text>
        {onBack && (
          <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="prn-back">
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // Display PRN medications for one-tap logging.
  return (
    <View style={styles.container} testID="prn-quick-log-screen">
      <Text style={styles.title}>PRN Quick Log</Text>
      <Text style={styles.subtitle}>Tap a medication to log a dose.</Text>
      <ScrollView style={styles.list}>
        {prnMedications.map((med) => (
          <Pressable
            key={med.id}
            style={styles.medicationCard}
            onPress={() => void handleQuickLog(med)}
            disabled={isLogging}
            accessibilityRole="button"
            accessibilityLabel={`Log ${med.drugName} PRN dose`}
            testID={`prn-log-${med.id}`}
          >
            <Text style={styles.medName}>{med.drugName}</Text>
            <Text style={styles.medDose}>{med.dosage}</Text>
            <Text style={styles.medLimit}>
              24h max: {med.prn!.safetyLimit24h} {med.prn!.doseUnit}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {onBack && (
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" testID="prn-back">
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Evaluation Display Sub-Component
// ---------------------------------------------------------------------------

interface PrnEvaluationDisplayProps {
  attempt: LogAttemptState;
  onOverride: () => void;
  onDismiss: () => void;
  isLogging: boolean;
}

/**
 * Renders the PrnQuickLogEvaluation outcome including any safety-threshold-
 * exceeded result (Requirement 9.5). This is displayed before accepting
 * another PRN quick-log entry.
 */
function PrnEvaluationDisplay({
  attempt,
  onOverride,
  onDismiss,
  isLogging,
}: PrnEvaluationDisplayProps): React.ReactElement {
  const { evaluation, prn, drugName, persisted, persistError } = attempt;

  // Safety threshold exceeded — blocked (Requirement 9.5).
  if (evaluation.blocked) {
    return (
      <View style={styles.evaluationContainer} testID="prn-evaluation-result">
        <View style={styles.warningBanner}>
          <Text style={styles.warningTitle} accessibilityRole="alert" testID="prn-safety-exceeded">
            Safety Threshold Exceeded
          </Text>
          <Text style={styles.warningText}>
            {drugName}: logging this dose would bring the 24-hour total to{' '}
            {evaluation.projectedCumulative} {prn.doseUnit}, exceeding the{' '}
            {prn.safetyLimit24h} {prn.doseUnit} safety limit.
          </Text>
          <Text style={styles.cumulativeText} testID="prn-cumulative-display">
            Current 24h total: {evaluation.existingCumulative} {prn.doseUnit}
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            style={styles.overrideButton}
            onPress={onOverride}
            disabled={isLogging}
            accessibilityRole="button"
            accessibilityLabel="Override safety warning and log dose"
            testID="prn-override-button"
          >
            <Text style={styles.overrideButtonText}>
              {isLogging ? 'Logging...' : 'Override & Log'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.dismissButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Cancel and do not log dose"
            testID="prn-dismiss-button"
          >
            <Text style={styles.dismissButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Dose was recorded (within limit or override acknowledged).
  return (
    <View style={styles.evaluationContainer} testID="prn-evaluation-result">
      <View style={evaluation.overrideFlag ? styles.overrideBanner : styles.successBanner}>
        <Text
          style={styles.resultTitle}
          testID={evaluation.overrideFlag ? 'prn-logged-override' : 'prn-logged'}
        >
          {evaluation.overrideFlag ? 'Dose Logged (Override)' : 'Dose Logged'}
        </Text>
        <Text style={styles.resultText}>
          {drugName}: {prn.doseAmount} {prn.doseUnit} recorded.
        </Text>
        <Text style={styles.cumulativeText} testID="prn-cumulative-display">
          24h total: {evaluation.projectedCumulative} / {prn.safetyLimit24h} {prn.doseUnit}
        </Text>
        {evaluation.overrideFlag && (
          <Text style={styles.overrideNotice} testID="prn-override-notice">
            This dose exceeded the safety limit and was acknowledged.
          </Text>
        )}
      </View>

      {/* Persistence status (Requirement 9.7) */}
      {persistError && (
        <Text style={styles.persistErrorText} accessibilityRole="alert" testID="prn-persist-error">
          {persistError}
        </Text>
      )}
      {persisted && (
        <Text style={styles.persistSuccessText} testID="prn-persist-success">
          Saved successfully.
        </Text>
      )}

      <Pressable
        style={styles.continueButton}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Continue to log another dose"
        testID="prn-continue-button"
      >
        <Text style={styles.continueButtonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 14,
    color: '#555',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#777',
    textAlign: 'center',
    marginTop: 32,
  },
  errorText: {
    color: '#c00',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 32,
  },
  list: {
    flex: 1,
  },
  medicationCard: {
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0e3f5',
  },
  medName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0066cc',
    marginBottom: 4,
  },
  medDose: {
    fontSize: 14,
    color: '#333',
  },
  medLimit: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  evaluationContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  warningBanner: {
    padding: 20,
    backgroundColor: '#fff3e0',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ff9800',
    marginBottom: 16,
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e65100',
    marginBottom: 8,
  },
  warningText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
  },
  successBanner: {
    padding: 20,
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4caf50',
    marginBottom: 16,
  },
  overrideBanner: {
    padding: 20,
    backgroundColor: '#fff8e1',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffc107',
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2e7d32',
    marginBottom: 8,
  },
  resultText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  cumulativeText: {
    fontSize: 13,
    color: '#555',
    marginTop: 4,
  },
  overrideNotice: {
    fontSize: 13,
    color: '#e65100',
    fontStyle: 'italic',
    marginTop: 8,
  },
  persistErrorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  persistSuccessText: {
    color: '#2e7d32',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  overrideButton: {
    flex: 1,
    padding: 14,
    backgroundColor: '#ff9800',
    borderRadius: 8,
    alignItems: 'center',
  },
  overrideButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  dismissButton: {
    flex: 1,
    padding: 14,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  dismissButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#555',
  },
  continueButton: {
    padding: 14,
    backgroundColor: '#0066cc',
    borderRadius: 8,
    alignItems: 'center',
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  backButton: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  backButtonText: {
    fontSize: 16,
    color: '#555',
    fontWeight: '500',
  },
});
