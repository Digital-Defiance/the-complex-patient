/**
 * FHIR R4 Bundle builder for clinical export.
 *
 * Requirements: clinical-export 1.1, 1.2
 */

import type {
  Association,
  Condition,
  FlareUp,
  MedicationProfile,
  PrnLog,
  SymptomEntry,
} from '@complex-patient/domain';
import type { ClinicalExportSource, FhirBundle, FhirBundleEntry } from './types';
import { filterActive } from './partition';
import {
  ASSOCIATION_PROVENANCE_CODE,
  DOMAIN_EXTENSION_URL,
  EXPORT_PROVENANCE_CODE,
  EXPORT_SYSTEM,
} from './constants';

const FHIR_NS = 'http://hl7.org/fhir';
const PATIENT_ID = 'patient-1';

function withDomainExtension(
  resource: Record<string, unknown>,
  payload: unknown,
): Record<string, unknown> {
  const existing = (resource.extension as unknown[] | undefined) ?? [];
  return {
    ...resource,
    extension: [
      ...existing,
      { url: DOMAIN_EXTENSION_URL, valueString: JSON.stringify(payload) },
    ],
  };
}

function recordUrl(recordId: string): string {
  return `urn:uuid:${recordId}`;
}

function patientReference(): { reference: string } {
  return { reference: `Patient/${PATIENT_ID}` };
}

function buildPatient(): Record<string, unknown> {
  return {
    resourceType: 'Patient',
    id: PATIENT_ID,
    meta: { profile: [`${FHIR_NS}/StructureDefinition/Patient`] },
    text: {
      status: 'generated',
      div: '<div xmlns="http://www.w3.org/1999/xhtml">Complex Patient export (anonymous placeholder)</div>',
    },
  };
}

function buildMedicationStatement(med: MedicationProfile): Record<string, unknown> {
  return withDomainExtension(
    {
      resourceType: 'MedicationStatement',
      id: med.id,
      meta: { lastUpdated: med.op_timestamp },
      status: med.active ? 'active' : 'completed',
      subject: patientReference(),
      medicationCodeableConcept: {
        text: `${med.drugName} (${med.form}, ${med.dosage})`,
      },
      dosage: [
        {
          text: med.dosage,
        },
      ],
      note: [
        {
          text: `Prescriber: ${med.prescribingPhysician}. Condition treated: ${med.conditionTreated}. Schedule: ${JSON.stringify(med.schedule)}`,
        },
      ],
    },
    {
      kind: 'medication',
      drugName: med.drugName,
      dosage: med.dosage,
      form: med.form,
      prescribingPhysician: med.prescribingPhysician,
      conditionTreated: med.conditionTreated,
      active: med.active,
      schedule: med.schedule,
      prn: med.prn,
    },
  );
}

function buildCondition(condition: Condition): Record<string, unknown> {
  return withDomainExtension(
    {
      resourceType: 'Condition',
      id: condition.id,
      meta: { lastUpdated: condition.op_timestamp },
      clinicalStatus: {
        coding: [{ system: `${FHIR_NS}/condition-clinical`, code: 'active' }],
      },
      subject: patientReference(),
      code: { text: condition.name },
    },
    { kind: 'condition', name: condition.name },
  );
}

function buildSymptomObservation(symptom: SymptomEntry): Record<string, unknown> {
  const durationText = `${symptom.duration.value} ${symptom.duration.unit}`;
  return withDomainExtension(
    {
      resourceType: 'Observation',
      id: symptom.id,
      meta: { lastUpdated: symptom.op_timestamp },
      status: symptom.active ? 'final' : 'entered-in-error',
      category: [
        {
          coding: [{ system: `${FHIR_NS}/observation-category`, code: 'survey' }],
          text: 'Symptom',
        },
      ],
      code: {
        text: `${symptom.symptomType} — ${symptom.systemicLocation}`,
      },
      subject: patientReference(),
      effectiveDateTime: symptom.op_timestamp,
      valueInteger: symptom.severity,
      note: [
        {
          text: `Duration: ${durationText}. Notes: ${symptom.notes || '(none)'}`,
        },
      ],
    },
    {
      kind: 'symptom',
      symptomType: symptom.symptomType,
      systemicLocation: symptom.systemicLocation,
      severity: symptom.severity,
      duration: symptom.duration,
      notes: symptom.notes,
      active: symptom.active,
    },
  );
}

function buildFlareEncounter(flare: FlareUp): Record<string, unknown> {
  return withDomainExtension(
    {
      resourceType: 'Encounter',
      id: flare.id,
      meta: { lastUpdated: flare.op_timestamp },
      status: 'finished',
      class: {
        system: `${FHIR_NS}/v3/ActCode`,
        code: 'OBS',
        display: 'Observation',
      },
      subject: patientReference(),
      reasonCode: [{ text: flare.trigger }],
      extension: [
        {
          url: `${EXPORT_SYSTEM}/flare-symptom-ids`,
          valueString: flare.symptomIds.join(','),
        },
      ],
    },
    {
      kind: 'flare',
      symptomIds: flare.symptomIds,
      trigger: flare.trigger,
    },
  );
}

function buildPrnAdministration(
  log: PrnLog,
  medicationName: string | undefined,
): Record<string, unknown> {
  return withDomainExtension(
    {
      resourceType: 'MedicationAdministration',
      id: log.id,
      meta: { lastUpdated: log.op_timestamp },
      status: 'completed',
      subject: patientReference(),
      medicationCodeableConcept: {
        text: medicationName ?? log.medicationId,
      },
      effectiveDateTime: log.takenAt,
      dosage: {
        text: `${log.amount}${log.override ? ' (override)' : ''}`,
      },
    },
    {
      kind: 'prn-log',
      medicationId: log.medicationId,
      amount: log.amount,
      takenAt: log.takenAt,
      override: log.override,
    },
  );
}

function buildAssociationProvenance(
  association: Association,
  exportedAt: string,
): Record<string, unknown> {
  return withDomainExtension(
    {
      resourceType: 'Provenance',
      id: `assoc-${association.id}`,
      recorded: association.op_timestamp,
      activity: {
        coding: [{ system: EXPORT_SYSTEM, code: ASSOCIATION_PROVENANCE_CODE }],
      },
      agent: [{ who: patientReference() }],
      entity: [
        {
          role: 'source',
          what: { reference: `Observation/${association.symptomId}` },
        },
      ],
      extension: [
        {
          url: `${EXPORT_SYSTEM}/condition-ids`,
          valueString: association.conditionIds.join(','),
        },
        {
          url: `${EXPORT_SYSTEM}/medication-ids`,
          valueString: association.medicationIds.join(','),
        },
      ],
    },
    {
      kind: 'association',
      symptomId: association.symptomId,
      conditionIds: association.conditionIds,
      medicationIds: association.medicationIds,
    },
  );
}

function buildExportProvenance(exportedAt: string): Record<string, unknown> {
  return {
    resourceType: 'Provenance',
    id: 'export-provenance',
    recorded: exportedAt,
    activity: {
      coding: [{ system: EXPORT_SYSTEM, code: EXPORT_PROVENANCE_CODE }],
      text: 'On-device Complex Patient clinical export',
    },
    agent: [{ who: patientReference() }],
  };
}

function entryFor(resource: Record<string, unknown>, id: string): FhirBundleEntry {
  return {
    fullUrl: recordUrl(id),
    resource,
  };
}

/**
 * Build a FHIR R4 collection Bundle from decrypted vault records.
 */
export function buildFhirBundle(source: ClinicalExportSource, exportedAt = new Date().toISOString()): FhirBundle {
  const medications = filterActive(source.medications);
  const prnLogs = filterActive(source.prnLogs);
  const symptoms = filterActive(source.symptoms);
  const conditions = filterActive(source.conditions);
  const flares = filterActive(source.flares);
  const associations = filterActive(source.associations);

  const medicationNames = new Map(medications.map((med) => [med.id, med.drugName]));
  const entries: FhirBundleEntry[] = [];

  entries.push(entryFor(buildPatient(), PATIENT_ID));

  for (const med of medications) {
    entries.push(entryFor(buildMedicationStatement(med), med.id));
  }

  for (const condition of conditions) {
    entries.push(entryFor(buildCondition(condition), condition.id));
  }

  for (const symptom of symptoms) {
    entries.push(entryFor(buildSymptomObservation(symptom), symptom.id));
  }

  for (const flare of flares) {
    entries.push(entryFor(buildFlareEncounter(flare), flare.id));
  }

  for (const log of prnLogs) {
    entries.push(
      entryFor(buildPrnAdministration(log, medicationNames.get(log.medicationId)), log.id),
    );
  }

  for (const association of associations) {
    entries.push(entryFor(buildAssociationProvenance(association, exportedAt), `assoc-${association.id}`));
  }

  entries.push(entryFor(buildExportProvenance(exportedAt), 'export-provenance'));

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: exportedAt,
    entry: entries,
  };
}
