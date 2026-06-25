/**
 * @complex-patient/ui — Paper backup recovery on the unlock screen
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { HomeEntryController } from '../../app/home-entry';
import { decodePaperBackupQrPayload, PAPER_BACKUP_QR_PREFIX } from '@complex-patient/crypto-engine';
import { createKdfMaterialStorage, type KdfMaterialStorage } from './kdf-material-storage';
import { PaperBackupQrScanner } from './PaperBackupQrScanner';

export interface PaperBackupRecoveryPanelProps {
  home: HomeEntryController;
  kdfStorage: KdfMaterialStorage;
  onRecovered: () => void;
}

export function PaperBackupRecoveryPanel({
  home,
  kdfStorage,
  onRecovered,
}: PaperBackupRecoveryPanelProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [backupId, setBackupId] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [qrPayload, setQrPayload] = useState('');
  const [scanning, setScanning] = useState(false);

  const applyRecoveryInput = useCallback((rawMnemonic: string, rawBackupId: string) => {
    const trimmedMnemonic = rawMnemonic.trim();
    if (trimmedMnemonic.startsWith(PAPER_BACKUP_QR_PREFIX)) {
      const decoded = decodePaperBackupQrPayload(trimmedMnemonic);
      if (decoded) {
        setBackupId(decoded.backupId);
        setMnemonic(decoded.mnemonic);
        return;
      }
    }
    setMnemonic(rawMnemonic);
    setBackupId(rawBackupId);
  }, []);

  const handleQrScan = useCallback(
    (payload: string) => {
      setQrPayload(payload);
      setError(null);
      applyRecoveryInput(payload, backupId);
    },
    [applyRecoveryInput, backupId],
  );

  const handleRecover = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { saveKdfMaterial } = createKdfMaterialStorage(kdfStorage);

    const effectiveMnemonic = qrPayload.trim() || mnemonic;
    const effectiveBackupId = backupId.trim();

    try {
      let resolvedMnemonic = effectiveMnemonic;
      let resolvedBackupId = effectiveBackupId;
      if (effectiveMnemonic.startsWith(PAPER_BACKUP_QR_PREFIX)) {
        const decoded = decodePaperBackupQrPayload(effectiveMnemonic);
        if (!decoded) {
          setError('QR payload is invalid. Paste the full scanned text or enter words manually.');
          return;
        }
        resolvedMnemonic = decoded.mnemonic;
        resolvedBackupId = decoded.backupId;
      }

      const result = await home.recoverWithPaperBackup(
        resolvedMnemonic,
        resolvedBackupId,
        async (material) => {
        await saveKdfMaterial({
          salt: material.salt,
          params: material.params,
        });
      });

      if (result.ok) {
        onRecovered();
        return;
      }

      switch (result.reason) {
        case 'INVALID_MNEMONIC':
          setError('Enter all 24 recovery words exactly as written on your paper backup.');
          break;
        case 'NOT_FOUND':
          setError('No backup found with that Backup ID. Check the id printed on your sheet.');
          break;
        case 'DECRYPT_FAILED':
          setError('Recovery words do not match this backup. Check spelling and order.');
          break;
        case 'NOT_AUTHENTICATED':
          setError('Session expired. Sign in again, then recover.');
          break;
        default:
          setError('Recovery failed. Try again or use your master passphrase.');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Recovery failed unexpectedly.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [backupId, home, kdfStorage, mnemonic, onRecovered, qrPayload]);

  if (!expanded) {
    return (
      <Pressable
        style={styles.linkButton}
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        testID="unlock-paper-backup-toggle"
      >
        <Text style={styles.linkText}>Recover with paper backup</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.panel} testID="paper-backup-recovery-panel">
      <Text style={styles.panelTitle}>Paper backup recovery</Text>
      <Text style={styles.panelHint}>
        Enter the Backup ID and 24 words from your printed sheet, scan the QR code, or paste the
        scanned payload.
      </Text>

      <Pressable
        style={styles.scanButton}
        onPress={() => setScanning(true)}
        disabled={loading}
        accessibilityRole="button"
        testID="paper-backup-recovery-scan"
      >
        <Text style={styles.scanButtonText}>Scan QR code</Text>
      </Pressable>

      {scanning ? (
        <PaperBackupQrScanner
          onScan={handleQrScan}
          onClose={() => setScanning(false)}
        />
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Scanned QR payload (optional)"
        value={qrPayload}
        onChangeText={(value) => {
          setQrPayload(value);
          setError(null);
          if (value.trim().startsWith(PAPER_BACKUP_QR_PREFIX)) {
            applyRecoveryInput(value, backupId);
          }
        }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
        testID="paper-backup-recovery-qr"
      />

      <TextInput
        style={styles.input}
        placeholder="Backup ID (from printed sheet)"
        value={backupId}
        onChangeText={setBackupId}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
        testID="paper-backup-recovery-id"
      />

      <TextInput
        style={[styles.input, styles.mnemonicInput]}
        placeholder="24 recovery words"
        value={mnemonic}
        onChangeText={setMnemonic}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        editable={!loading}
        testID="paper-backup-recovery-mnemonic"
      />

      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={() => void handleRecover()}
        disabled={loading}
        accessibilityRole="button"
        testID="paper-backup-recovery-submit"
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Recover vault</Text>}
      </Pressable>

      <Pressable
        style={styles.linkButton}
        onPress={() => {
          setExpanded(false);
          setScanning(false);
          setError(null);
        }}
        accessibilityRole="button"
      >
        <Text style={styles.linkText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    marginTop: 16,
    gap: 8,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  panelHint: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 4,
  },
  scanButton: {
    borderWidth: 1,
    borderColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f3f8ff',
  },
  scanButtonText: {
    color: '#0066cc',
    fontWeight: '600',
    fontSize: 15,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
  mnemonicInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  error: {
    color: '#c00',
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  linkButton: {
    marginTop: 8,
    padding: 8,
    alignItems: 'center',
  },
  linkText: {
    color: '#0066cc',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
