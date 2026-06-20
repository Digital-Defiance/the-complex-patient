/**
 * @complex-patient/ui — ImportScreen
 *
 * v2.1: preview and merge password-protected clinical export ZIP files into the vault.
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
  applyClinicalImportMerge,
  filterActive,
  previewClinicalImport,
  splitMedicationsPartition,
  validateImportMergeConsent,
  validateImportPassword,
  type FhirBundle,
  type ImportPreview,
  type MergeStats,
} from '@complex-patient/clinical-export';
import { useAppHost } from '../app-host';

export interface ImportScreenProps {
  onBack: () => void;
  fileBytes: Uint8Array | null;
  fileName?: string | null;
  onClearFile: () => void;
  onRequestFile?: () => void;
  fileSelectionAvailable: boolean;
}

type ImportPhase = 'idle' | 'previewing' | 'ready' | 'merging' | 'merged' | 'error';

const MERGE_CONSENT_LABEL =
  'I want to merge imported records into my vault. Existing records with the same id are updated only when the import is newer.';

export function ImportScreen({
  onBack,
  fileBytes,
  fileName = null,
  onClearFile,
  onRequestFile,
  fileSelectionAvailable,
}: ImportScreenProps): React.ReactElement {
  const { home } = useAppHost();

  const [zipPassword, setZipPassword] = useState('');
  const [mergeConsented, setMergeConsented] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [bundle, setBundle] = useState<FhirBundle | null>(null);
  const [mergeStats, setMergeStats] = useState<MergeStats | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);

  useEffect(() => {
    setPreview(null);
    setBundle(null);
    setMergeStats(null);
    setPhase('idle');
    setStatusMessage(null);
    setValidationMessage(null);
  }, [fileBytes]);

  const importBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!fileBytes) blockers.push('Choose an export zip file.');
    if (!zipPassword.trim()) blockers.push('Enter the zip password.');
    return blockers;
  }, [fileBytes, zipPassword]);

  const canPreview = useMemo(
    () => home !== null && !readError && fileBytes !== null && zipPassword.trim().length > 0 && phase !== 'previewing' && phase !== 'merging',
    [fileBytes, home, phase, readError, zipPassword],
  );

  const canMerge = useMemo(
    () =>
      home !== null &&
      !readError &&
      bundle !== null &&
      preview?.isComplexPatientExport === true &&
      mergeConsented &&
      phase === 'ready',
    [bundle, home, mergeConsented, phase, preview, readError],
  );

  const handlePreview = useCallback(async () => {
    if (!home) return;

    if (!fileBytes) {
      setValidationMessage('Choose an export zip file first.');
      return;
    }

    const passwordError = validateImportPassword(zipPassword);
    if (passwordError) {
      setValidationMessage(passwordError);
      return;
    }

    setValidationMessage(null);
    setPhase('previewing');
    setPreview(null);
    setBundle(null);
    setMergeStats(null);
    setStatusMessage(null);

    const result = await previewClinicalImport(fileBytes, zipPassword);

    if (result.status === 'error') {
      setPhase('error');
      setStatusMessage(result.message);
      return;
    }

    setPreview(result.preview);
    setBundle(result.bundle ?? null);
    setPhase('ready');
    setStatusMessage(
      result.preview.isComplexPatientExport
        ? 'Export recognized. Review the summary, then confirm merge.'
        : 'File opened, but it does not look like a Complex Patient export.',
    );
  }, [fileBytes, home, zipPassword]);

  const handleMerge = useCallback(async () => {
    if (!home || !bundle) return;

    const consentError = validateImportMergeConsent(mergeConsented);
    if (consentError) {
      setValidationMessage(consentError);
      return;
    }

    setValidationMessage(null);
    setPhase('merging');
    setStatusMessage(null);

    try {
      const medications = home.read<VaultRecord>('medications');
      const split = splitMedicationsPartition(medications.records);
      const current = {
        medications: split.medications,
        prnLogs: split.prnLogs,
        symptoms: filterActive(home.read('symptoms').records),
        conditions: filterActive(home.read('conditions').records),
        flares: filterActive(home.read('flares').records),
        associations: filterActive(home.read('associations').records),
      };

      const result = await applyClinicalImportMerge(bundle, current, async (vaultType, nextRecords) => {
        const commitResult = await home.commit(vaultType, () => nextRecords);
        if (!commitResult.ok) {
          return { ok: false, message: 'Could not merge imported records into the vault.' };
        }
        return { ok: true };
      });

      if (result.status === 'error') {
        setPhase('error');
        setStatusMessage(result.message);
        return;
      }

      setMergeStats(result.totals);
      setPhase('merged');
      setStatusMessage(
        `Import complete. Added ${result.totals.added}, updated ${result.totals.updated}, skipped ${result.totals.skipped}.`,
      );
    } catch {
      setReadError(true);
      setPhase('error');
      setStatusMessage('Data unavailable. Please try again later.');
    }
  }, [bundle, home, mergeConsented]);

  if (!home || readError) {
    return (
      <View style={styles.container} accessibilityLabel="Import clinical export">
        <Text style={styles.errorText} accessibilityRole="alert" testID="import-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
        <Pressable style={styles.secondaryButton} onPress={onBack} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} accessibilityLabel="Import clinical export">
      <Text style={styles.title}>Import Export</Text>
      <Text style={styles.lead}>
        Preview and merge a password-protected Complex Patient export zip into your unlocked vault.
      </Text>

      <View style={styles.fileBox} testID="import-file-status">
        <Text style={styles.fieldLabel}>Export file</Text>
        <Text style={styles.fileStatus}>
          {fileBytes ? fileName ?? 'Zip file selected' : 'No file selected'}
        </Text>
        <View style={styles.fileActions}>
          {fileSelectionAvailable && onRequestFile && (
            <Pressable
              style={styles.secondaryButton}
              onPress={onRequestFile}
              accessibilityRole="button"
              testID="import-choose-file"
            >
              <Text style={styles.secondaryButtonText}>Choose file</Text>
            </Pressable>
          )}
          {fileBytes && (
            <Pressable
              style={styles.secondaryButton}
              onPress={onClearFile}
              accessibilityRole="button"
              testID="import-clear-file"
            >
              <Text style={styles.secondaryButtonText}>Clear</Text>
            </Pressable>
          )}
        </View>
        {!fileSelectionAvailable && (
          <Text style={styles.noteText}>
            File selection is not available on this platform yet.
          </Text>
        )}
      </View>

      <Text style={styles.fieldLabel}>Zip password</Text>
      <TextInput
        style={styles.input}
        value={zipPassword}
        onChangeText={setZipPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Zip password"
        testID="import-zip-password"
      />

      {importBlockers.length > 0 && phase !== 'previewing' && phase !== 'merging' && (
        <View style={styles.requirementsBox} testID="import-requirements">
          <Text style={styles.requirementsTitle}>Before you can preview:</Text>
          {importBlockers.map((blocker) => (
            <Text key={blocker} style={styles.requirementsItem}>
              • {blocker}
            </Text>
          ))}
        </View>
      )}

      {validationMessage && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="import-validation-error">
          {validationMessage}
        </Text>
      )}

      {statusMessage && (
        <Text
          style={phase === 'error' ? styles.errorText : styles.noteText}
          accessibilityRole="alert"
          testID="import-status-message"
        >
          {statusMessage}
        </Text>
      )}

      {preview && (
        <View style={styles.previewBox} testID="import-preview">
          <Text style={styles.previewTitle}>Preview summary</Text>
          <Text style={styles.previewLine}>Exported at: {preview.exportedAt ?? 'Unknown'}</Text>
          <Text style={styles.previewLine}>
            Complex Patient export: {preview.isComplexPatientExport ? 'Yes' : 'No'}
          </Text>
          <Text style={styles.previewLine}>Total resources: {preview.totalResources}</Text>
          {Object.entries(preview.resourceCounts).map(([type, count]) => (
            <Text key={type} style={styles.previewLine}>
              {type}: {count}
            </Text>
          ))}
        </View>
      )}

      {preview?.isComplexPatientExport && phase !== 'merged' && (
        <Pressable
          style={styles.checkboxRow}
          onPress={() => setMergeConsented((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: mergeConsented }}
          testID="import-merge-consent-checkbox"
        >
          <View style={[styles.checkbox, mergeConsented && styles.checkboxChecked]} />
          <Text style={styles.checkboxLabel}>{MERGE_CONSENT_LABEL}</Text>
        </Pressable>
      )}

      {mergeStats && (
        <View style={styles.previewBox} testID="import-merge-summary">
          <Text style={styles.previewTitle}>Merge summary</Text>
          <Text style={styles.previewLine}>Added: {mergeStats.added}</Text>
          <Text style={styles.previewLine}>Updated: {mergeStats.updated}</Text>
          <Text style={styles.previewLine}>Skipped: {mergeStats.skipped}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.primaryButton, !canPreview && styles.buttonDisabled]}
          onPress={handlePreview}
          disabled={!canPreview}
          accessibilityRole="button"
          accessibilityLabel="Preview import"
          testID="import-preview-submit"
        >
          {phase === 'previewing' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Preview import</Text>
          )}
        </Pressable>

        {preview?.isComplexPatientExport && (
          <Pressable
            style={[styles.primaryButton, styles.mergeButton, !canMerge && styles.buttonDisabled]}
            onPress={handleMerge}
            disabled={!canMerge}
            accessibilityRole="button"
            accessibilityLabel="Merge import into vault"
            testID="import-merge-submit"
          >
            {phase === 'merging' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Merge into vault</Text>
            )}
          </Pressable>
        )}

        <Pressable style={styles.secondaryButton} onPress={onBack} accessibilityRole="button" testID="import-back">
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
  fileBox: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  fileStatus: {
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
  },
  fileActions: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
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
  previewBox: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f0f7ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0e3f5',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    color: '#0066cc',
  },
  previewLine: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
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
  noteText: {
    color: '#555',
    marginBottom: 12,
    lineHeight: 20,
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
  mergeButton: {
    backgroundColor: '#067a36',
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
    paddingVertical: 10,
    paddingHorizontal: 14,
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
});
