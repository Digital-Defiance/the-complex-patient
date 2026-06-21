/**
 * Read decrypted vault partitions into a clinical export source snapshot.
 */

import {
  filterActive,
  splitMedicationsPartition,
  type ClinicalExportSource,
} from '@complex-patient/clinical-export';
import type { HomeEntryController } from './home-entry';

/** Count clinical records that will appear in the FHIR bundle (excludes location trail). */
export function countExportRecords(source: ClinicalExportSource): number {
  return (
    source.medications.length +
    source.prnLogs.length +
    source.symptoms.length +
    source.conditions.length +
    source.flares.length +
    source.associations.length
  );
}

/**
 * Read the current in-memory vault projections for export.
 * Requires `home.getStatus() === 'ready'`.
 */
export function readClinicalExportSource(home: HomeEntryController): ClinicalExportSource {
  const medications = home.read('medications');
  const symptoms = home.read('symptoms');
  const conditions = home.read('conditions');
  const flares = home.read('flares');
  const associations = home.read('associations');
  const locationTrail = home.read('locationTrail');
  const split = splitMedicationsPartition(medications.records);

  return {
    medications: split.medications,
    prnLogs: split.prnLogs,
    symptoms: filterActive(symptoms.records),
    conditions: filterActive(conditions.records),
    flares: filterActive(flares.records),
    associations: filterActive(associations.records),
    locationTrail: filterActive(locationTrail.records),
  };
}
