import { describe, expect, it } from 'vitest';
import { generatePaperBackupMnemonic } from './paper-backup';
import {
  decodePaperBackupQrPayload,
  encodePaperBackupQrPayload,
  generatePaperBackupQrDataUrl,
  qrMatrixSide,
  renderQrSvgDataUrl,
} from './paper-backup-qr';
import { toQR } from 'toqr';

describe('paper-backup-qr', () => {
  const backupId = '11111111-1111-4111-8111-111111111111';

  it('round-trips backup id and mnemonic in QR payload', () => {
    const mnemonic = generatePaperBackupMnemonic();
    const payload = encodePaperBackupQrPayload(backupId, mnemonic);
    const decoded = decodePaperBackupQrPayload(payload);
    expect(decoded).toEqual({ backupId, mnemonic });
  });

  it('renders a QR matrix to an SVG data URL', () => {
    const mnemonic = generatePaperBackupMnemonic();
    const dataUrl = generatePaperBackupQrDataUrl(backupId, mnemonic);
    expect(dataUrl.startsWith('data:image/svg+xml')).toBe(true);

    const matrix = toQR(encodePaperBackupQrPayload(backupId, mnemonic));
    expect(qrMatrixSide(matrix)).toBeGreaterThan(20);
    expect(renderQrSvgDataUrl(matrix)).toContain('data:image/svg+xml');
  });
});
