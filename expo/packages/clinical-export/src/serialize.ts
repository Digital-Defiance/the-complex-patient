/**
 * Stable JSON serialization for FHIR export.
 */

import type { FhirBundle } from './types';

export function serializeFhirJson(bundle: FhirBundle): string {
  // Compact JSON keeps the encrypted archive smaller and encrypts faster on web.
  return `${JSON.stringify(bundle)}\n`;
}
