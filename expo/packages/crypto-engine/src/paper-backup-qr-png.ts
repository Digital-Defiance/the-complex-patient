/**
 * PNG QR rendering for native React Native Image views.
 */

import {
  encodePaperBackupQrPayload,
  qrMatrixSide,
} from './paper-backup-qr';
import { encodeRgbaPng } from './png-encode';
import { toQR } from 'toqr';

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  throw new Error('base64 encoding is unavailable');
}

/** Render a `toQR` bitmap as a PNG data URL (works in React Native Image). */
export function renderQrPngDataUrl(matrix: Uint8Array, modulePx = 4): string {
  const side = qrMatrixSide(matrix);
  const width = side * modulePx;
  const height = side * modulePx;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const moduleX = Math.floor(x / modulePx);
      const moduleY = Math.floor(y / modulePx);
      const dark = Boolean(matrix[moduleY * side + moduleX]);
      const value = dark ? 0 : 255;
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }

  const png = encodeRgbaPng(width, height, rgba);
  return `data:image/png;base64,${bytesToBase64(png)}`;
}

/** Generate a PNG QR data URL for native clients (single Image view, not thousands of Views). */
export function generatePaperBackupQrPngDataUrl(backupId: string, mnemonic: string): string {
  const payload = encodePaperBackupQrPayload(backupId, mnemonic);
  const matrix = toQR(payload);
  return renderQrPngDataUrl(matrix);
}
