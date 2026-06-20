/**
 * Password-protected ZIP packaging for clinical export.
 *
 * Requirements: clinical-export 2.1, 2.2
 */

import { BlobWriter, TextReader, ZipWriter } from './zip-entry';
import { EXPORT_JSON_FILENAME } from './types';

export interface PackExportZipOptions {
  json: string;
  zipPassword: string;
}

/**
 * Pack FHIR JSON into an AES-256 encrypted ZIP archive.
 */
export async function packExportZip(options: PackExportZipOptions): Promise<Uint8Array> {
  const { json, zipPassword } = options;

  if (!zipPassword) {
    throw new Error('Zip password is required.');
  }

  const writer = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(writer, {
    password: zipPassword,
    encryptionStrength: 3,
  });

  await zipWriter.add(EXPORT_JSON_FILENAME, new TextReader(json));
  await zipWriter.close();

  const blob = await writer.getData();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}
