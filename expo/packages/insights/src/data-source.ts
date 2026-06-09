/**
 * @complex-patient/insights — In-memory vault data source
 *
 * A trivial {@link VaultDataSource} backed by already-decrypted records held in
 * client memory. This is the seam through which the UI passes the decrypted
 * Local_Vault partitions into the analysis pipeline without the pipeline ever
 * touching storage or the network (Requirement 19.1).
 */

import type { SymptomEntry, PrnLog } from '@complex-patient/domain';
import type { MedEvent, VaultDataSource } from './types';

/**
 * Construct a read-only {@link VaultDataSource} over in-memory arrays.
 *
 * Defensive copies are taken at construction time so later mutations of the
 * caller's arrays cannot retroactively change analysis inputs, and the returned
 * accessors hand back stable, frozen snapshots.
 */
export function createInMemoryVaultDataSource(input: {
  symptoms?: readonly SymptomEntry[];
  prnLogs?: readonly PrnLog[];
  medEvents?: readonly MedEvent[];
}): VaultDataSource {
  const symptoms = Object.freeze([...(input.symptoms ?? [])]);
  const prnLogs = Object.freeze([...(input.prnLogs ?? [])]);
  const medEvents = Object.freeze([...(input.medEvents ?? [])]);

  return {
    getSymptoms: () => symptoms,
    getPrnLogs: () => prnLogs,
    getMedEvents: () => medEvents,
  };
}
