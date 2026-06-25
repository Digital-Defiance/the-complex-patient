import type { PaperBackupPrintOptions } from './paper-backup-print-html';

/** No-op on unsupported platforms. */
export async function printPaperBackupSheet(_options: PaperBackupPrintOptions): Promise<void> {
  // Native and web provide platform-specific implementations.
}

export async function sharePaperBackupSheet(_options: PaperBackupPrintOptions): Promise<void> {
  // Native provides share via PDF; web uses print dialog.
}

export type { PaperBackupPrintOptions };
