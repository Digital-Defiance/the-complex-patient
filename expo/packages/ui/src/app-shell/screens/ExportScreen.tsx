/**
 * @complex-patient/ui — ExportScreen
 *
 * On-device clinical export: consent, zip password, FHIR bundle + encrypted ZIP.
 * Reads exclusively through `home.read` while unlocked. No Sync_Backend involvement.
 *
 * Requirements: clinical-export 1.4, 3.1, 3.2, 3.3
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import {
  createClinicalExport,
  validateExportPasswords,
  type ClinicalExportProgress,
  type ClinicalExportSource,
} from '@complex-patient/clinical-export';
import { countExportRecords, readClinicalExportSource } from '../../app/export-source';
import { useAppHost } from '../app-host';
import { beginExportSession } from '../export-session';

export interface ExportScreenProps {
  /** Navigate back to home. */
  onBack: () => void;
  /** Platform adapter to save or share the generated ZIP bytes. */
  onSaveExport: (bytes: Uint8Array, filename: string) => Promise<void>;
}

type ExportPhase = 'idle' | 'exporting' | 'ready' | 'error';

const CONSENT_LABEL =
  'I understand this export contains decrypted health data that can be read without Complex Patient. The zip password protects the file in transit only.';

function formatExportSummary(source: ClinicalExportSource): string {
  const parts: string[] = [];
  if (source.medications.length > 0) parts.push(`${source.medications.length} medications`);
  if (source.prnLogs.length > 0) parts.push(`${source.prnLogs.length} PRN logs`);
  if (source.symptoms.length > 0) parts.push(`${source.symptoms.length} symptoms`);
  if (source.conditions.length > 0) parts.push(`${source.conditions.length} conditions`);
  if (source.flares.length > 0) parts.push(`${source.flares.length} flares`);
  if (source.associations.length > 0) parts.push(`${source.associations.length} associations`);
  return parts.join(', ');
}

export function ExportScreen({ onBack, onSaveExport }: ExportScreenProps): React.ReactElement {
  const { home } = useAppHost();

  const [source, setSource] = useState<ClinicalExportSource | null>(null);
  const [readError, setReadError] = useState(false);
  const [consented, setConsented] = useState(false);
  const [zipPassword, setZipPassword] = useState('');
  const [zipPasswordConfirm, setZipPasswordConfirm] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ClinicalExportProgress | null>(null);

  const reloadSource = useCallback(() => {
    if (!home) {
      setReadError(true);
      setSource(null);
      return;
    }

    if (home.getStatus() !== 'ready') {
      setReadError(true);
      setSource(null);
      return;
    }

    try {
      setSource(readClinicalExportSource(home));
      setReadError(false);
    } catch {
      setSource(null);
      setReadError(true);
    }
  }, [home]);

  useEffect(() => {
    reloadSource();
    if (!home) {
      return undefined;
    }

    const unsubscribeStatus = home.subscribeStatus((status) => {
      if (status === 'ready') {
        reloadSource();
      }
    });
    const unsubscribeSync = home.coordinator.syncStatus.subscribe(() => {
      if (home.getStatus() === 'ready') {
        reloadSource();
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeSync();
    };
  }, [home, reloadSource]);

  const passwordsValid = useMemo(() => {
    if (!zipPassword.trim()) return false;
    return zipPassword === zipPasswordConfirm;
  }, [zipPassword, zipPasswordConfirm]);

  const exportBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!consented) blockers.push('Check the consent box.');
    if (!zipPassword.trim()) blockers.push('Enter a zip password.');
    else if (zipPassword !== zipPasswordConfirm) blockers.push('Zip passwords must match.');
    if (source !== null && countExportRecords(source) === 0) {
      blockers.push('Add clinical records to your vault before exporting.');
    }
    return blockers;
  }, [consented, source, zipPassword, zipPasswordConfirm]);

  const canExport =
    consented &&
    passwordsValid &&
    !readError &&
    source !== null &&
    countExportRecords(source) > 0 &&
    phase !== 'exporting';

  const recordCount = source ? countExportRecords(source) : 0;
  const largeExport = recordCount >= 250;

  useEffect(() => {
    if (phase !== 'exporting') {
      return undefined;
    }

    const endExportSession = beginExportSession();
    home?.lock.suspendIdle();

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      endExportSession();
      home?.lock.resumeIdle();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    };
  }, [home, phase]);

  const handleExport = useCallback(async () => {
    if (!home || home.getStatus() !== 'ready') {
      setValidationMessage('Unlock your vault before exporting.');
      return;
    }

    let freshSource: ClinicalExportSource;
    try {
      freshSource = readClinicalExportSource(home);
      setSource(freshSource);
    } catch {
      setValidationMessage('Could not read vault data. Try again after unlocking.');
      return;
    }

    if (countExportRecords(freshSource) === 0) {
      setValidationMessage(
        'Nothing to export. This vault has no clinical records on this device — they may have been cleared during a recovery unlock, or you may need to re-enter data.',
      );
      return;
    }

    const validationError = validateExportPasswords(consented, zipPassword, zipPasswordConfirm);
    if (validationError) {
      setValidationMessage(validationError);
      return;
    }

    setValidationMessage(null);
    setPhase('exporting');
    setStatusMessage(null);
    setExportProgress({
      stage: 'building-fhir',
      percent: 0,
      message: 'Starting export…',
    });

    const result = await createClinicalExport({
      source: freshSource,
      zipPassword,
      onProgress: (progress) => {
        home?.notifyActivity();
        setExportProgress(progress);
      },
    });

    if (result.status === 'error') {
      setPhase('error');
      setExportProgress(null);
      setStatusMessage(result.message);
      return;
    }

    try {
      setExportProgress({
        stage: 'saving',
        percent: 92,
        message: 'Saving export file…',
      });
      await onSaveExport(result.zipBytes, result.filename);
      setExportProgress({
        stage: 'complete',
        percent: 100,
        message: 'Export ready.',
      });
      setPhase('ready');
      setStatusMessage('Export saved. Share the zip file only with people you trust.');
    } catch {
      setPhase('error');
      setExportProgress(null);
      setStatusMessage('Could not save the export file.');
    }
  }, [consented, home, onSaveExport, zipPassword, zipPasswordConfirm]);

  if (!home || readError) {
    return (
      <View style={styles.container} accessibilityLabel="Clinical export">
        <Text style={styles.errorText} accessibilityRole="alert" testID="export-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
        <Pressable style={styles.secondaryButton} onPress={onBack} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} accessibilityLabel="Clinical export">
      <Text style={styles.title}>Clinical Export</Text>
      <Text style={styles.lead}>
        Export decrypted health data as a FHIR JSON bundle plus a clinician-readable Markdown
        summary, inside a password-protected zip file. This happens entirely on your device.
      </Text>

      {source !== null && recordCount > 0 && phase !== 'exporting' && (
        <View style={styles.summaryBox} testID="export-record-summary">
          <Text style={styles.summaryTitle}>Ready to export</Text>
          <Text style={styles.summaryText}>
            {recordCount} clinical record{recordCount === 1 ? '' : 's'} ({formatExportSummary(source)})
          </Text>
        </View>
      )}

      {source !== null && recordCount === 0 && phase !== 'exporting' && (
        <View style={styles.emptyVaultBox} testID="export-empty-vault">
          <Text style={styles.emptyVaultTitle}>No clinical data on this device</Text>
          <Text style={styles.emptyVaultText}>
            Export would contain only metadata. If you expected records here, they may have been cleared
            during vault recovery, or this device never received synced data from the server.
          </Text>
        </View>
      )}

      <View style={styles.warningBox} testID="export-consent-warning">
        <Text style={styles.warningTitle}>Important</Text>
        <Text style={styles.warningText}>
          Anyone with the zip password can read your exported data in standard tools. Complex Patient
          zero-knowledge protection does not apply to exported files.
        </Text>
      </View>

      {largeExport && phase !== 'exporting' && (
        <View style={styles.durationWarningBox} testID="export-duration-warning">
          <Text style={styles.durationWarningTitle}>Large export</Text>
          <Text style={styles.durationWarningText}>
            This vault has a lot of data. Encrypting the zip can take 5 minutes or longer in the
            browser. Keep this tab open and in the foreground until the download starts.
          </Text>
        </View>
      )}

      {Platform.OS === 'web' && phase !== 'exporting' && (
        <Text style={styles.webHint} testID="export-web-hint">
          Web exports encrypt in your browser (AES-256, no compression). Very large vaults
          can still take a few minutes; keep this tab open until the download starts.
        </Text>
      )}

      <Pressable
        style={styles.checkboxRow}
        onPress={() => setConsented((value) => !value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consented }}
        testID="export-consent-checkbox"
      >
        <View style={[styles.checkbox, consented && styles.checkboxChecked]} />
        <Text style={styles.checkboxLabel}>{CONSENT_LABEL}</Text>
      </Pressable>

      <Text style={styles.fieldLabel}>Zip password</Text>
      <TextInput
        style={styles.input}
        value={zipPassword}
        onChangeText={setZipPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Zip password"
        testID="export-zip-password"
      />

      <Text style={styles.fieldLabel}>Confirm zip password</Text>
      <TextInput
        style={styles.input}
        value={zipPasswordConfirm}
        onChangeText={setZipPasswordConfirm}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Confirm zip password"
        testID="export-zip-password-confirm"
      />

      {exportBlockers.length > 0 && phase !== 'exporting' && (
        <View style={styles.requirementsBox} testID="export-requirements">
          <Text style={styles.requirementsTitle}>Before you can export:</Text>
          {exportBlockers.map((blocker) => (
            <Text key={blocker} style={styles.requirementsItem}>
              • {blocker}
            </Text>
          ))}
        </View>
      )}

      {validationMessage && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="export-validation-error">
          {validationMessage}
        </Text>
      )}

      {phase === 'exporting' && exportProgress && (
        <View style={styles.progressBox} testID="export-progress">
          <Text style={styles.progressMessage}>{exportProgress.message}</Text>
          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: exportProgress.percent }}
          >
            <View
              style={[
                styles.progressFill,
                exportProgress.stage === 'encrypting' &&
                  exportProgress.percent >= 50 &&
                  exportProgress.percent < 92 &&
                  styles.progressFillActive,
                { width: `${exportProgress.percent}%` },
              ]}
            />
          </View>
          <Text style={styles.progressPercent}>{exportProgress.percent}%</Text>
          {exportProgress.stage === 'encrypting' && exportProgress.percent >= 50 && exportProgress.percent < 92 && (
            <Text style={styles.progressHint} testID="export-progress-hint">
              Encryption is the long step. Elapsed time in the message is real; the bar moves with time, not zip milestones. Keep this tab open.
            </Text>
          )}
        </View>
      )}

      {statusMessage && (
        <Text
          style={phase === 'error' ? styles.errorText : styles.successText}
          accessibilityRole="alert"
          testID="export-status-message"
        >
          {statusMessage}
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.primaryButton, !canExport && styles.buttonDisabled]}
          onPress={handleExport}
          disabled={!canExport}
          accessibilityRole="button"
          accessibilityLabel="Export clinical data"
          testID="export-submit"
        >
          {phase === 'exporting' ? (
            <View style={styles.exportingButtonContent}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.primaryButtonText}>Exporting…</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>Export</Text>
          )}
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={onBack} accessibilityRole="button" testID="export-back">
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  lead: {
    fontSize: 16,
    color: '#444',
    marginBottom: 16,
    lineHeight: 22,
  },
  summaryBox: {
    backgroundColor: '#eef8f0',
    borderColor: '#9fd4a8',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  summaryTitle: {
    fontWeight: '700',
    marginBottom: 6,
    color: '#1f5f2d',
  },
  summaryText: {
    color: '#2f4f35',
    lineHeight: 20,
  },
  emptyVaultBox: {
    backgroundColor: '#fff1f0',
    borderColor: '#f5a5a0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  emptyVaultTitle: {
    fontWeight: '700',
    marginBottom: 8,
    color: '#8a1f1f',
  },
  emptyVaultText: {
    color: '#5c2f2f',
    lineHeight: 20,
  },
  warningBox: {
    backgroundColor: '#fff8e6',
    borderColor: '#f0c36d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  warningTitle: {
    fontWeight: '700',
    marginBottom: 8,
    color: '#8a5a00',
  },
  warningText: {
    color: '#5c4a1f',
    lineHeight: 20,
  },
  durationWarningBox: {
    backgroundColor: '#fff1f0',
    borderColor: '#f5a5a0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  durationWarningTitle: {
    fontWeight: '700',
    marginBottom: 8,
    color: '#8a1f1a',
  },
  durationWarningText: {
    color: '#5c1f1a',
    lineHeight: 20,
  },
  webHint: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
    marginBottom: 16,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#0066cc',
    borderRadius: 4,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#0066cc',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    fontSize: 16,
  },
  requirementsBox: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    color: '#333',
  },
  requirementsItem: {
    fontSize: 14,
    color: '#555',
    marginBottom: 2,
  },
  progressBox: {
    marginBottom: 16,
    gap: 8,
  },
  progressMessage: {
    fontSize: 14,
    color: '#333',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#0066cc',
    borderRadius: 999,
  },
  progressFillActive: {
    backgroundColor: '#004999',
  },
  progressPercent: {
    fontSize: 12,
    color: '#666',
    textAlign: 'right',
  },
  progressHint: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  exportingButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  secondaryButton: {
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
  buttonDisabled: {
    opacity: 0.5,
  },
  errorText: {
    color: '#c00',
    marginBottom: 12,
  },
  successText: {
    color: '#067a36',
    marginBottom: 12,
  },
});
