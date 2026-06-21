/**
 * Password-protected ZIP packaging for clinical export.
 *
 * Requirements: clinical-export 2.1, 2.2
 */

import type { PackProgressStep } from './export-progress';
import { packExportZipCore, type PackExportZipOptions } from './pack-core';
import { canUsePackWorker, packExportZipInWorker } from './pack-worker-client';

export type { PackExportZipOptions };

/**
 * Pack FHIR JSON into an AES-256 encrypted ZIP archive.
 *
 * On web, packaging runs in a dedicated worker when supported so encryption
 * does not block the main thread for several minutes.
 */
export async function packExportZip(options: PackExportZipOptions): Promise<Uint8Array> {
  if (canUsePackWorker()) {
    return packExportZipInWorker(options);
  }
  return packExportZipCore(options);
}

export { packExportZipCore };
