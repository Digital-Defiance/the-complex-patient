/**
 * Background location trail samples (opt-in, mobile).
 *
 * Rounded coordinates stored in the encrypted `locationTrail` partition.
 * Used to resolve where the user was on days without explicit log-time GPS.
 */

import type { VaultRecord } from './types';

/** A single approximate location fix along the user's trail. */
export interface LocationTrailSample extends VaultRecord {
  latitude: number;
  longitude: number;
  /** ISO 8601 instant when the sample was captured. */
  capturedAt: string;
}
