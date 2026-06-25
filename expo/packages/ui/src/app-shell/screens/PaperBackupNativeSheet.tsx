/**
 * Native paper-backup display — staged grid + deferred QR.
 *
 * Android release builds crash when the full web template mounts at once (flexWrap
 * word grid inside a parent ScrollView). Rows and QR mount in phases so layout stays
 * stable. QR uses a cache-file PNG, not data: URIs or SVG.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import type { PaperBackupTemplate } from '@complex-patient/crypto-engine';
import { PaperBackupQrCode } from './PaperBackupQrCode';

export interface PaperBackupNativeSheetProps {
  template: PaperBackupTemplate;
  qrDataUrl: string;
}

const WORD_ROW_COUNT = 12;

function formatCreatedAt(createdAt: PaperBackupTemplate['createdAt']): string {
  if (createdAt instanceof Date) {
    return createdAt.toISOString();
  }
  return String(createdAt);
}

function WordChip({ index, word }: { index: number; word: string }): React.ReactElement {
  return (
    <View style={styles.wordChip}>
      <Text style={styles.wordChipText}>
        {String(index + 1).padStart(2, ' ')}. {word}
      </Text>
    </View>
  );
}

export function PaperBackupNativeSheet({
  template,
  qrDataUrl,
}: PaperBackupNativeSheetProps): React.ReactElement {
  const [visibleRows, setVisibleRows] = useState(0);
  const [showQr, setShowQr] = useState(false);

  const wordRows = useMemo(() => {
    const rows: Array<[string, string | undefined]> = [];
    for (let row = 0; row < WORD_ROW_COUNT; row += 1) {
      const left = template.words[row * 2];
      const right = template.words[row * 2 + 1];
      if (left !== undefined) {
        rows.push([left, right]);
      }
    }
    return rows;
  }, [template.words]);

  const warningsText = useMemo(
    () => template.warnings.map((warning) => `• ${warning}`).join('\n'),
    [template.warnings],
  );

  useEffect(() => {
    setVisibleRows(0);
    setShowQr(false);

    let row = 0;
    let cancelled = false;

    const revealRows = (): void => {
      if (cancelled) {
        return;
      }
      row += 1;
      setVisibleRows(Math.min(row, wordRows.length));
      if (row < wordRows.length) {
        requestAnimationFrame(revealRows);
      }
    };

    const frame = requestAnimationFrame(revealRows);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [template.backupId, wordRows.length]);

  useEffect(() => {
    if (visibleRows < wordRows.length) {
      setShowQr(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowQr(true);
    }, 300);

    return () => clearTimeout(timer);
  }, [visibleRows, wordRows.length, template.backupId]);

  return (
    <View style={styles.container} testID="paper-backup-native-sheet">
      <Text style={styles.heading}>Paper backup key</Text>
      <Text style={styles.meta}>Backup ID: {template.backupId}</Text>
      {template.label ? <Text style={styles.meta}>Label: {template.label}</Text> : null}
      <Text style={styles.meta}>Created: {formatCreatedAt(template.createdAt)}</Text>

      <View style={styles.wordGrid} testID="paper-backup-word-grid">
        {wordRows.slice(0, visibleRows).map(([leftWord, rightWord], rowIndex) => (
          <View key={`row-${rowIndex}-${leftWord}`} style={styles.wordRow}>
            <WordChip index={rowIndex * 2} word={leftWord} />
            {rightWord ? (
              <WordChip index={rowIndex * 2 + 1} word={rightWord} />
            ) : (
              <View style={styles.wordChipSpacer} />
            )}
          </View>
        ))}
        {visibleRows < wordRows.length ? (
          <ActivityIndicator
            size="small"
            accessibilityLabel="Loading recovery words"
            testID="paper-backup-word-grid-loading"
          />
        ) : null}
      </View>

      {visibleRows >= wordRows.length ? (
        <>
          <View style={styles.qrBlock}>
            <Text style={styles.qrLabel}>Scan to recover on another device</Text>
            {showQr ? (
              <PaperBackupQrCode
                backupId={template.backupId}
                mnemonic={template.words.join(' ')}
                qrDataUrl={qrDataUrl}
              />
            ) : (
              <ActivityIndicator
                size="large"
                accessibilityLabel="Loading QR code"
                testID="paper-backup-qr-loading"
              />
            )}
          </View>

          <Text style={styles.warningTitle}>Warnings</Text>
          <Text style={styles.warning}>{warningsText}</Text>
          <Text style={styles.instructions}>{template.instructions}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8a1f1f',
    marginBottom: 8,
  },
  meta: {
    fontSize: 12,
    color: '#444',
    marginBottom: 4,
  },
  wordGrid: {
    marginTop: 8,
    marginBottom: 8,
  },
  wordRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  wordChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
    marginRight: 6,
  },
  wordChipSpacer: {
    flex: 1,
    marginRight: 6,
  },
  wordChipText: {
    fontSize: 13,
    color: '#222',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : undefined,
  },
  qrBlock: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  qrLabel: {
    fontSize: 12,
    color: '#555',
    marginBottom: 6,
  },
  warningTitle: {
    fontWeight: '700',
    color: '#8a1f1f',
    marginTop: 4,
    marginBottom: 4,
  },
  warning: {
    fontSize: 12,
    color: '#663333',
    lineHeight: 18,
    marginBottom: 8,
  },
  instructions: {
    fontSize: 12,
    color: '#444',
    lineHeight: 18,
  },
});
