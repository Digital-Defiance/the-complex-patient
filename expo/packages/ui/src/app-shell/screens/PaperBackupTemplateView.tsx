/**
 * Printable paper-backup sheet with numbered word grid and QR code.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import type { PaperBackupTemplate } from '@complex-patient/crypto-engine';
import { PaperBackupQrCode } from './PaperBackupQrCode';

export interface PaperBackupTemplateViewProps {
  template: PaperBackupTemplate;
  templateText: string;
  qrDataUrl: string;
}

export function PaperBackupTemplateView({
  template,
  templateText,
  qrDataUrl,
}: PaperBackupTemplateViewProps): React.ReactElement {
  const mnemonic = template.words.join(' ');
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    setShowQr(false);
    const frame = requestAnimationFrame(() => {
      setShowQr(true);
      console.log('[PaperBackup] showing qr block');
    });
    return () => cancelAnimationFrame(frame);
  }, [template.backupId]);

  return (
    <View style={styles.container} testID="paper-backup-template-view">
      <Text style={styles.heading}>Paper backup key</Text>
      <Text style={styles.meta}>Backup ID: {template.backupId}</Text>
      {template.label ? <Text style={styles.meta}>Label: {template.label}</Text> : null}
      <Text style={styles.meta}>Created: {template.createdAt.toISOString()}</Text>

      <View style={styles.wordGrid} accessibilityRole="list" accessibilityLabel="Recovery words">
        {template.words.map((word, index) => (
          <View key={`${index}-${word}`} style={styles.wordChip} accessibilityRole="listitem">
            <Text style={styles.wordChipText}>
              {String(index + 1).padStart(2, ' ')}. {word}
            </Text>
          </View>
        ))}
      </View>

      {showQr ? (
        <View style={styles.qrBlock}>
          <Text style={styles.qrLabel}>Scan to recover on another device</Text>
          <PaperBackupQrCode
            backupId={template.backupId}
            mnemonic={mnemonic}
            qrDataUrl={qrDataUrl}
          />
        </View>
      ) : null}

      <Text style={styles.warningTitle}>Warnings</Text>
      {template.warnings.map((warning) => (
        <Text key={warning} style={styles.warning}>
          • {warning}
        </Text>
      ))}

      <Text style={styles.instructions}>{template.instructions}</Text>

      {Platform.OS === 'web' ? (
        <>
          <Text style={styles.plainTextLabel}>Plain-text copy</Text>
          <Text style={styles.plainText} selectable>
            {templateText}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8a1f1f',
  },
  meta: {
    fontSize: 12,
    color: '#444',
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  wordChip: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  wordChipText: {
    fontSize: 13,
    color: '#222',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  qrBlock: {
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  qrLabel: {
    fontSize: 12,
    color: '#555',
  },
  warningTitle: {
    fontWeight: '700',
    color: '#8a1f1f',
    marginTop: 4,
  },
  warning: {
    fontSize: 12,
    color: '#663333',
    lineHeight: 18,
  },
  instructions: {
    fontSize: 12,
    color: '#444',
    lineHeight: 18,
  },
  plainTextLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginTop: 8,
  },
  plainText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    lineHeight: 16,
    color: '#222',
  },
});
