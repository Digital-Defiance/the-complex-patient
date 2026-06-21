/**
 * Shared ZIP packaging implementation (main thread or worker).
 */

import { BlobReader, BlobWriter, ZipWriter } from './zip-entry';
import type { PackProgressStep } from './export-progress';
import { EXPORT_JSON_FILENAME, EXPORT_MARKDOWN_FILENAME } from './types';
import { buildWinZipAesMultiArchive } from './zip-aes-archive';
import { canUseWinZipAesWebCrypto, encryptWinZipAes256 } from './winzip-aes-web-crypto';

/** Zip STORE (no deflate) — text payloads; AES-256 is the protection. */
const ZIP_STORE = { level: 0, compressionMethod: 0 } as const;

export interface ExportZipFile {
  filename: string;
  content: string;
}

export interface PackExportZipOptions {
  json: string;
  markdown: string;
  zipPassword: string;
  onPackProgress?: (step: PackProgressStep, message: string) => void;
}

function exportZipFiles(options: PackExportZipOptions): ExportZipFile[] {
  return [
    { filename: EXPORT_JSON_FILENAME, content: options.json },
    { filename: EXPORT_MARKDOWN_FILENAME, content: options.markdown },
  ];
}

async function packExportZipWebCrypto(options: PackExportZipOptions): Promise<Uint8Array> {
  const { zipPassword, onPackProgress } = options;
  onPackProgress?.('encrypt', 'Applying AES-256 encryption (accelerated)…');

  const archiveEntries = [];
  for (const file of exportZipFiles(options)) {
    const plaintext = new TextEncoder().encode(file.content);
    archiveEntries.push({
      filename: file.filename,
      encryptedPayload: await encryptWinZipAes256(plaintext, zipPassword),
      uncompressedSize: plaintext.length,
    });
  }

  onPackProgress?.('read-blob', 'Finalizing encrypted archive…');
  const zipBytes = buildWinZipAesMultiArchive(archiveEntries);

  onPackProgress?.('finalize', 'Preparing download…');
  return zipBytes;
}

async function packExportZipZipJs(options: PackExportZipOptions): Promise<Uint8Array> {
  const { zipPassword, onPackProgress } = options;

  onPackProgress?.('encrypt', 'Applying AES-256 encryption…');

  const writer = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(writer, {
    password: zipPassword,
    encryptionStrength: 3,
    ...ZIP_STORE,
  });

  for (const file of exportZipFiles(options)) {
    const blob = new Blob([file.content], {
      type: file.filename.endsWith('.json') ? 'application/json' : 'text/markdown',
    });
    await zipWriter.add(file.filename, new BlobReader(blob), ZIP_STORE);
  }

  onPackProgress?.('read-blob', 'Finalizing encrypted archive…');
  await zipWriter.close();

  onPackProgress?.('finalize', 'Preparing download…');
  const blob = await writer.getData();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Pack FHIR JSON and Markdown summary into an AES-256 encrypted ZIP archive.
 *
 * On web with SubtleCrypto, uses hardware-accelerated WinZip AES instead of
 * zip.js SJCL. Falls back to zip.js elsewhere (Node tests, native).
 */
export async function packExportZipCore(options: PackExportZipOptions): Promise<Uint8Array> {
  const { zipPassword } = options;

  if (!zipPassword) {
    throw new Error('Zip password is required.');
  }

  if (canUseWinZipAesWebCrypto()) {
    return packExportZipWebCrypto(options);
  }

  return packExportZipZipJs(options);
}
