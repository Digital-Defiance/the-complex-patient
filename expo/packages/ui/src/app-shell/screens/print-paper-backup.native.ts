/**
 * Native print and share for paper backup sheets (AirPrint / Android print).
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildPaperBackupPrintHtml, type PaperBackupPrintOptions } from './paper-backup-print-html';

export type { PaperBackupPrintOptions };

/** Open the system print dialog (includes AirPrint on iOS). */
export async function printPaperBackupSheet(options: PaperBackupPrintOptions): Promise<void> {
  const html = buildPaperBackupPrintHtml(options);
  await Print.printAsync({ html });
}

/** Save a PDF and open the share sheet (print, save to Files, etc.). */
export async function sharePaperBackupSheet(options: PaperBackupPrintOptions): Promise<void> {
  const html = buildPaperBackupPrintHtml(options);
  const { uri } = await Print.printToFileAsync({ html });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Paper backup sheet',
    UTI: 'com.adobe.pdf',
  });
}
