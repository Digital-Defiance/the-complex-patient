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
} from 'react-native';
import type { VaultRecord } from '@complex-patient/domain';
import {
  createClinicalExport,
  filterActive,
  splitMedicationsPartition,
  validateExportPasswords,
  type ClinicalExportSource,
} from '@complex-patient/clinical-export';
import { useAppHost } from '../app-host';

export interface ExportScreenProps {
  /** Navigate back to home. */
  onBack: () => void;
  /** Platform adapter to save or share the generated ZIP bytes. */
  onSaveExport: (bytes: Uint8Array, filename: string) => Promise<void>;
}

type ExportPhase = 'idle' | 'exporting' | 'ready' | 'error';

const CONSENT_LABEL =
  'I understand this export contains decrypted health data that can be read without Complex Patient. The zip password protects the file in transit only.';

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

  useEffect(() => {
    if (!home) {
      setReadError(true);
      setSource(null);
      return;
    }

    try {
      const medications = home.read<VaultRecord>('medications');
      const symptoms = home.read('symptoms');
      const conditions = home.read('conditions');
      const flares = home.read('flares');
      const associations = home.read('associations');
      const split = splitMedicationsPartition(medications.records);

      setSource({
        medications: split.medications,
        prnLogs: split.prnLogs,
        symptoms: filterActive(symptoms.records),
        conditions: filterActive(conditions.records),
        flares: filterActive(flares.records),
        associations: filterActive(associations.records),
      });
      setReadError(false);
    } catch {
      setSource(null);
      setReadError(true);
    }
  }, [home]);

  const passwordsValid = useMemo(() => {
    if (!zipPassword.trim()) return false;
    return zipPassword === zipPasswordConfirm;
  }, [zipPassword, zipPasswordConfirm]);

  const exportBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!consented) blockers.push('Check the consent box.');
    if (!zipPassword.trim()) blockers.push('Enter a zip password.');
    else if (zipPassword !== zipPasswordConfirm) blockers.push('Zip passwords must match.');
    return blockers;
  }, [consented, zipPassword, zipPasswordConfirm]);

  const canExport = consented && passwordsValid && !readError && source !== null && phase !== 'exporting';

  const handleExport = useCallback(async () => {
    if (!source) return;

    const validationError = validateExportPasswords(consented, zipPassword, zipPasswordConfirm);
    if (validationError) {
      setValidationMessage(validationError);
      return;
    }

    setValidationMessage(null);
    setPhase('exporting');
    setStatusMessage(null);

    const result = await createClinicalExport({ source, zipPassword });

    if (result.status === 'error') {
      setPhase('error');
      setStatusMessage(result.message);
      return;
    }

    try {
      await onSaveExport(result.zipBytes, result.filename);
      setPhase('ready');
      setStatusMessage('Export saved. Share the zip file only with people you trust.');
    } catch {
      setPhase('error');
      setStatusMessage('Could not save the export file.');
    }
  }, [consented, onSaveExport, source, zipPassword, zipPasswordConfirm]);

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
        Export decrypted health data as a FHIR JSON bundle inside a password-protected zip file.
        This happens entirely on your device.
      </Text>

      <View style={styles.warningBox} testID="export-consent-warning">
        <Text style={styles.warningTitle}>Important</Text>
        <Text style={styles.warningText}>
          Anyone with the zip password can read your exported data in standard tools. Complex Patient
          zero-knowledge protection does not apply to exported files.
        </Text>
      </View>

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
            <ActivityIndicator color="#fff" />
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
