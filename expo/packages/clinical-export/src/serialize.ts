/**
 * Stable JSON serialization for FHIR export.
 */

import type { FhirBundle } from './types';

export function serializeFhirJson(bundle: FhirBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
