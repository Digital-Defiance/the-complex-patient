/**
 * @complex-patient/ui — Paper backup management (settings)
 *
 * Lets unlocked users create, view, and revoke paper backup keys. Mnemonics are
 * shown once at creation and never stored on the server.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import type { PaperBackupTemplate } from '@complex-patient/crypto-engine';
import type { KdfMaterial } from '../../app/kdf-material-sync';
import type { PaperBackupSummary } from '../../app/home-entry';
import { useAppHost } from '../app-host';
import { createKdfMaterialStorage, type KdfMaterialStorage } from './kdf-material-storage';
import { PaperBackupTemplateView } from './PaperBackupTemplateView';
import { PaperBackupNativeSheet } from './PaperBackupNativeSheet';
import { PaperBackupVerificationStep } from './PaperBackupVerificationStep';
import { printPaperBackupSheet, sharePaperBackupSheet } from './print-paper-backup';
import { showAppAlert, confirmAppAction } from '../app-alert';

type CreatedBackupFlow = 'template' | 'verify';

function createPaperBackupErrorMessage(
  reason: 'NOT_UNLOCKED' | 'NO_HTTP' | 'UPLOAD_FAILED' | 'CRYPTO_FAILED',
  httpStatus?: number,
): string {
  const status = httpStatus ?? 0;
  switch (reason) {
    case 'NOT_UNLOCKED':
      return 'Your vault is locked. Go back to Home, unlock again, then return to Settings.';
    case 'NO_HTTP':
      return 'Not connected to your account server. Sign in again and retry.';
    case 'UPLOAD_FAILED':
      if (status === 404) {
        return 'Paper backup is not available on this server yet. Try again later or contact support if this continues.';
      }
      if (status === 401 || status === 403) {
        return 'Your session may have expired. Sign out, sign in again, unlock your vault, and retry.';
      }
      if (status === 0) {
        return 'Could not reach the server. Check your internet connection and try again.';
      }
      if (status === 500) {
        return 'The server could not save your paper backup. Wait a moment and try again.';
      }
      return 'Could not save your paper backup on the server. Try again in a moment.';
    case 'CRYPTO_FAILED':
      return 'Could not create backup keys in this browser. Try again or use a different browser.';
    default:
      return 'Could not create the paper backup. Try again while unlocked.';
  }
}

export interface PaperBackupSectionProps {
  kdfStorage: KdfMaterialStorage;
}

export function PaperBackupSection({ kdfStorage }: PaperBackupSectionProps): React.ReactElement {
  const { home } = useAppHost();
  const [backups, setBackups] = useState<PaperBackupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [createdBackup, setCreatedBackup] = useState<{
    template: PaperBackupTemplate;
    templateText: string;
    qrDataUrl: string;
    words: readonly string[];
  } | null>(null);
  const [createdTemplateReady, setCreatedTemplateReady] = useState(false);
  const [createdFlow, setCreatedFlow] = useState<CreatedBackupFlow>('template');
  const [backupVerified, setBackupVerified] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!home) {
      setBackups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setBackups(await home.listPaperBackups());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error('[PaperBackupSection] list failed:', message);
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!createdBackup) {
      setCreatedTemplateReady(false);
      return;
    }
    setCreatedTemplateReady(false);
    const frame = requestAnimationFrame(() => {
      setCreatedTemplateReady(true);
      console.log('[PaperBackup] template ready');
    });
    return () => cancelAnimationFrame(frame);
  }, [createdBackup]);

  const loadKdfMaterial = useCallback(async (): Promise<KdfMaterial | null> => {
    const { loadKdfMaterial: load } = createKdfMaterialStorage(kdfStorage);
    const stored = await load();
    if (!stored) {
      return null;
    }
    return { salt: stored.salt, params: stored.params };
  }, [kdfStorage]);

  const handleCreate = useCallback(async () => {
    if (!home) return;
    setErrorMessage(null);
    setStatusMessage(null);

    const material = await loadKdfMaterial();
    if (!material) {
      const message = 'Key-derivation settings are missing on this device. Unlock once with your master passphrase, then try again.';
      setErrorMessage(message);
      showAppAlert('Cannot create backup', message);
      return;
    }

    setCreating(true);
    try {
      const label = labelDraft.trim() || undefined;
      console.log('[PaperBackup] creating backup…');
      const result = await home.createPaperBackup(material, label);
      if (!result.ok) {
        console.error('[PaperBackupSection] create failed', {
          reason: result.reason,
          httpStatus: result.httpStatus ?? 0,
        });
        const message = createPaperBackupErrorMessage(result.reason, result.httpStatus ?? 0);
        setErrorMessage(message);
        showAppAlert('Could not create backup', message);
        return;
      }

      setLabelDraft('');
      setCreatedFlow('template');
      setBackupVerified(false);
      console.log('[PaperBackup] created', {
        backupId: result.backupId,
        qrBytes: result.qrDataUrl.length,
      });
      setCreatedBackup({
        template: result.template,
        templateText: result.templateText,
        qrDataUrl: result.qrDataUrl,
        words: result.template.words,
      });
      setStatusMessage('Paper backup created. Write down your 24 words and Backup ID now — they will not be shown again.');
      // Defer list refresh so the one-time template mount is not competing with re-render.
      setTimeout(() => void refresh(), 1000);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Paper backup creation failed unexpectedly.';
      console.error('[PaperBackupSection] create failed:', message);
      setErrorMessage(message);
      showAppAlert('Could not create backup', message);
    } finally {
      setCreating(false);
    }
  }, [home, labelDraft, loadKdfMaterial, refresh]);

  const handleRevoke = useCallback(
    async (backup: PaperBackupSummary) => {
      if (!home || revokingId !== null) return;

      const confirmed = await confirmAppAction(
        'Revoke paper backup?',
        `Backup ${backup.label ?? backup.backupId} will no longer work for recovery.`,
        { confirmLabel: 'Revoke', destructive: true },
      );
      if (!confirmed) {
        return;
      }

      setRevokingId(backup.backupId);
      setErrorMessage(null);
      try {
        const result = await home.revokePaperBackup(backup.backupId);
        if (!result.ok) {
          showAppAlert('Revoke failed', 'Could not remove this backup. Try again.');
          return;
        }
        await refresh();
        setStatusMessage('Paper backup revoked.');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Revoke failed unexpectedly.';
        console.error('[PaperBackupSection] revoke failed:', message);
        showAppAlert('Revoke failed', 'Could not remove this backup. Try again.');
      } finally {
        setRevokingId(null);
      }
    },
    [home, refresh, revokingId],
  );

  const handlePrint = useCallback(async () => {
    if (!createdBackup || printing) return;
    setPrinting(true);
    try {
      await printPaperBackupSheet({
        template: createdBackup.template,
        templateText: createdBackup.templateText,
        qrDataUrl: createdBackup.qrDataUrl,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not open the print dialog.';
      showAppAlert('Print failed', message);
    } finally {
      setPrinting(false);
    }
  }, [createdBackup, printing]);

  const handleShare = useCallback(async () => {
    if (!createdBackup || sharing) return;
    setSharing(true);
    try {
      await sharePaperBackupSheet({
        template: createdBackup.template,
        templateText: createdBackup.templateText,
        qrDataUrl: createdBackup.qrDataUrl,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not share the backup sheet.';
      showAppAlert('Share failed', message);
    } finally {
      setSharing(false);
    }
  }, [createdBackup, sharing]);

  const dismissCreatedBackup = useCallback(() => {
    setCreatedBackup(null);
    setCreatedFlow('template');
    setBackupVerified(false);
    setCreatedTemplateReady(false);
  }, []);

  if (!home || home.getStatus() !== 'ready') {
    return (
      <View style={styles.container} testID="paper-backup-locked">
        <Text style={styles.note}>Unlock your vault to manage paper backups.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="paper-backup-section">
      <Text style={styles.title}>Paper backup keys</Text>
      <Text style={styles.description}>
        Create printable recovery keys that unlock your vault without your master passphrase. Store
        them offline. Revoke any key you no longer trust. Support cannot recover your account.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Optional label (e.g. Home safe)"
        value={labelDraft}
        onChangeText={setLabelDraft}
        editable={!creating}
        testID="paper-backup-label"
      />

      <Pressable
        style={[styles.primaryButton, creating && styles.buttonDisabled]}
        onPress={() => void handleCreate()}
        disabled={creating}
        accessibilityRole="button"
        testID="paper-backup-create"
      >
        {creating ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Create paper backup</Text>
        )}
      </Pressable>

      {errorMessage ? (
        <Text style={styles.error} accessibilityRole="alert" testID="paper-backup-error">
          {errorMessage}
        </Text>
      ) : null}

      {statusMessage ? (
        <Text style={styles.success} testID="paper-backup-status">
          {statusMessage}
        </Text>
      ) : null}

      {createdBackup && (
        <>
          <View style={styles.templateBox} testID="paper-backup-template">
            <Text style={styles.templateTitle}>Save this sheet — shown once</Text>
            {Platform.OS !== 'web' ? (
              <Text style={styles.scrollHint}>
                Scroll down on this screen to see all 24 words and the QR code before continuing.
              </Text>
            ) : null}

            {createdFlow === 'template' ? (
              createdTemplateReady ? (
                Platform.OS === 'web' ? (
                  <PaperBackupTemplateView
                    template={createdBackup.template}
                    templateText={createdBackup.templateText}
                    qrDataUrl={createdBackup.qrDataUrl}
                  />
                ) : (
                  <PaperBackupNativeSheet
                    template={createdBackup.template}
                    qrDataUrl={createdBackup.qrDataUrl}
                  />
                )
              ) : (
                <ActivityIndicator
                  size="large"
                  accessibilityLabel="Preparing paper backup sheet"
                  testID="paper-backup-template-loading"
                />
              )
            ) : (
              <PaperBackupVerificationStep
                words={createdBackup.words}
                onVerified={() => setBackupVerified(true)}
                onBack={() => setCreatedFlow('template')}
              />
            )}
          </View>

          {createdFlow === 'template' ? (
            <View style={styles.templateActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void handlePrint()}
                disabled={printing || sharing}
                accessibilityRole="button"
                testID="paper-backup-print"
              >
                {printing ? (
                  <ActivityIndicator color="#555" />
                ) : (
                  <Text style={styles.secondaryButtonText}>
                    {Platform.OS === 'web' ? 'Print sheet' : 'Print or AirPrint'}
                  </Text>
                )}
              </Pressable>
              {Platform.OS !== 'web' ? (
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void handleShare()}
                  disabled={printing || sharing}
                  accessibilityRole="button"
                  testID="paper-backup-share"
                >
                  {sharing ? (
                    <ActivityIndicator color="#555" />
                  ) : (
                    <Text style={styles.secondaryButtonText}>Save PDF / share</Text>
                  )}
                </Pressable>
              ) : null}
              <Pressable
                style={styles.primaryButton}
                onPress={() => setCreatedFlow('verify')}
                accessibilityRole="button"
                testID="paper-backup-continue-verify"
              >
                <Text style={styles.primaryButtonText}>I wrote these down</Text>
              </Pressable>
            </View>
          ) : backupVerified ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={dismissCreatedBackup}
              accessibilityRole="button"
              testID="paper-backup-dismiss"
            >
              <Text style={styles.secondaryButtonText}>I saved my backup</Text>
            </Pressable>
          ) : null}
        </>
      )}

      <Text style={styles.listTitle}>Active backups</Text>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading paper backups" />
      ) : backups.length === 0 ? (
        <Text style={styles.empty}>No paper backups yet.</Text>
      ) : (
        backups.map((backup) => (
          <View key={backup.backupId} style={styles.row} testID={`paper-backup-row-${backup.backupId}`}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{backup.label ?? 'Paper backup'}</Text>
              <Text style={styles.rowMeta}>{backup.backupId}</Text>
              <Text style={styles.rowMeta}>Created {backup.createdAt}</Text>
            </View>
            <Pressable
              onPress={() => void handleRevoke(backup)}
              disabled={revokingId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Revoke backup ${backup.label ?? backup.backupId}`}
              testID={`paper-backup-revoke-${backup.backupId}`}
            >
              {revokingId === backup.backupId ? (
                <ActivityIndicator size="small" color="#c00" />
              ) : (
                <Text style={styles.revokeText}>Revoke</Text>
              )}
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  description: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  note: {
    fontSize: 14,
    color: '#666',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  primaryButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  error: {
    color: '#c62828',
    fontSize: 14,
    lineHeight: 20,
  },
  success: {
    color: '#2e7d32',
    fontSize: 14,
    lineHeight: 20,
  },
  secondaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },
  secondaryButtonText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '500',
  },
  templateBox: {
    borderWidth: 1,
    borderColor: '#c62828',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff8f8',
  },
  templateTitle: {
    fontWeight: '700',
    color: '#8a1f1f',
    marginBottom: 8,
  },
  scrollHint: {
    fontSize: 13,
    color: '#8a1f1f',
    lineHeight: 18,
    marginBottom: 8,
  },
  templateActions: {
    gap: 8,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
    color: '#333',
  },
  empty: {
    fontSize: 14,
    color: '#777',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  rowMeta: {
    fontSize: 12,
    color: '#666',
  },
  revokeText: {
    color: '#c62828',
    fontWeight: '600',
    fontSize: 14,
  },
});
