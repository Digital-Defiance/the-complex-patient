/**
 * Unpack a password-protected clinical export ZIP.
 *
 * Requirements: clinical-export v2 import preview
 */

import { BlobReader, TextWriter, ZipReader } from './zip-entry';
import { EXPORT_JSON_FILENAME, type FhirBundle } from './types';

export interface UnpackExportZipOptions {
  zipBytes: Uint8Array;
  zipPassword: string;
}

export type UnpackExportZipResult =
  | { status: 'ok'; json: string; bundle: FhirBundle }
  | { status: 'error'; message: string };

function isFhirBundle(value: unknown): value is FhirBundle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as FhirBundle;
  return candidate.resourceType === 'Bundle' && Array.isArray(candidate.entry);
}

/**
 * Decrypt and extract the FHIR JSON from an export ZIP.
 */
export async function unpackExportZip(options: UnpackExportZipOptions): Promise<UnpackExportZipResult> {
  const { zipBytes, zipPassword } = options;

  if (!zipPassword.trim()) {
    return { status: 'error', message: 'Zip password is required.' };
  }

  const reader = new ZipReader(new BlobReader(new Blob([zipBytes])));

  try {
    const entries = await reader.getEntries();
    const jsonEntry = entries.find((entry) => entry.filename === EXPORT_JSON_FILENAME);

    if (!jsonEntry?.getData) {
      return { status: 'error', message: 'Export JSON not found in zip.' };
    }

    const textWriter = new TextWriter();
    const json = await jsonEntry.getData(textWriter, { password: zipPassword });
    const parsed: unknown = JSON.parse(json);

    if (!isFhirBundle(parsed)) {
      return { status: 'error', message: 'Export file does not contain a valid FHIR Bundle.' };
    }

    return { status: 'ok', json, bundle: parsed };
  } catch {
    return { status: 'error', message: 'Could not decrypt export file. Check the password and file.' };
  } finally {
    await reader.close();
  }
}
