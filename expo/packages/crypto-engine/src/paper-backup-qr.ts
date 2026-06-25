/**
 * QR payload encoding and SVG rendering for paper backup sheets.
 */

import { toQR } from 'toqr';
import { normalizePaperBackupMnemonic, validatePaperBackupMnemonic } from './paper-backup';

/** Prefix for scannable paper-backup QR payloads. */
export const PAPER_BACKUP_QR_PREFIX = 'cppb:v1:';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Encode backup id + mnemonic for QR printing. */
export function encodePaperBackupQrPayload(backupId: string, mnemonic: string): string {
  const normalized = normalizePaperBackupMnemonic(mnemonic);
  return `${PAPER_BACKUP_QR_PREFIX}${backupId}:${normalized}`;
}

/** Parse a scanned or pasted QR payload. */
export function decodePaperBackupQrPayload(
  payload: string,
): { backupId: string; mnemonic: string } | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith(PAPER_BACKUP_QR_PREFIX)) {
    return null;
  }

  const rest = trimmed.slice(PAPER_BACKUP_QR_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) {
    return null;
  }

  const backupId = rest.slice(0, separator);
  const mnemonic = rest.slice(separator + 1);
  if (!UUID_PATTERN.test(backupId) || !validatePaperBackupMnemonic(mnemonic)) {
    return null;
  }

  return { backupId, mnemonic: normalizePaperBackupMnemonic(mnemonic) };
}

/** Side length of a square `toQR` module matrix. */
export function qrMatrixSide(matrix: Uint8Array): number {
  const side = Math.round(Math.sqrt(matrix.length));
  if (side * side !== matrix.length) {
    throw new Error('invalid QR matrix dimensions');
  }
  return side;
}

/** Render a `toQR` bitmap as an SVG data URL suitable for `<Image source={{ uri }}>`. */
export function renderQrSvgDataUrl(matrix: Uint8Array, modulePx = 4): string {
  const side = qrMatrixSide(matrix);
  const size = side * modulePx;
  const rects: string[] = [];

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (matrix[y * side + x]) {
        rects.push(
          `<rect x="${x * modulePx}" y="${y * modulePx}" width="${modulePx}" height="${modulePx}" fill="#000"/>`,
        );
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/>${rects.join('')}</svg>`;

  if (typeof Buffer !== 'undefined') {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Generate a scannable QR data URL for a paper backup sheet. */
export function generatePaperBackupQrDataUrl(backupId: string, mnemonic: string): string {
  const payload = encodePaperBackupQrPayload(backupId, mnemonic);
  const matrix = toQR(payload);
  return renderQrSvgDataUrl(matrix);
}

/** Square module matrix for rendering QR codes on native (RN Image cannot load SVG data URLs). */
export function generatePaperBackupQrMatrix(
  backupId: string,
  mnemonic: string,
): { matrix: Uint8Array; side: number } {
  const payload = encodePaperBackupQrPayload(backupId, mnemonic);
  const matrix = toQR(payload);
  return { matrix, side: qrMatrixSide(matrix) };
}
