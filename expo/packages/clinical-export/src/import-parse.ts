/**
 * Parse a FHIR export bundle back into domain records.
 *
 * v2.1: prefers domain-v1 extensions; falls back to FHIR field parsing for older exports.
 */

import type {
  Association,
  Condition,
  DoseRegimen,
  FlareUp,
  MedicationProfile,
  MedicationSchedule,
  PrnLog,
  SymptomEntry,
  TimeUnit,
  VaultRecord,
} from '@complex-patient/domain';
import {
  ASSOCIATION_PROVENANCE_CODE,
  DOMAIN_EXTENSION_URL,
  EXPORT_SYSTEM,
} from './constants';
import type { ClinicalExportSource, FhirBundle } from './types';

export interface ParsedClinicalImport {
  medications: MedicationProfile[];
  prnLogs: PrnLog[];
  symptoms: SymptomEntry[];
  conditions: Condition[];
  flares: FlareUp[];
  associations: Association[];
}

export type ParseFhirBundleResult =
  | { status: 'ok'; source: ParsedClinicalImport; warnings: string[] }
  | { status: 'error'; message: string };

type DomainExtensionPayload =
  | {
      kind: 'medication';
      drugName: string;
      regimens: DoseRegimen[];
      notes?: string;
      prescribingPhysician: string;
      conditionTreated: string;
      active: boolean;
    }
  | { kind: 'prn-log'; medicationId: string; amount: number; takenAt: string; override?: boolean }
  | { kind: 'symptom'; symptomType: string; systemicLocation: string; severity: number; duration: SymptomEntry['duration']; notes: string; active: boolean }
  | { kind: 'condition'; name: string }
  | { kind: 'flare'; symptomIds: string[]; trigger: string }
  | { kind: 'association'; symptomId: string; conditionIds: string[]; medicationIds: string[] };

function readMetaTimestamp(resource: Record<string, unknown>): string {
  const meta = resource.meta as { lastUpdated?: string } | undefined;
  if (typeof meta?.lastUpdated === 'string') return meta.lastUpdated;
  return new Date(0).toISOString();
}

function readDomainExtension(resource: Record<string, unknown>): DomainExtensionPayload | null {
  const extensions = resource.extension as Array<{ url?: string; valueString?: string }> | undefined;
  const match = extensions?.find((ext) => ext.url === DOMAIN_EXTENSION_URL);
  if (!match?.valueString) return null;

  try {
    return JSON.parse(match.valueString) as DomainExtensionPayload;
  } catch {
    return null;
  }
}

function readExtensionString(
  resource: Record<string, unknown>,
  url: string,
): string | undefined {
  const extensions = resource.extension as Array<{ url?: string; valueString?: string }> | undefined;
  return extensions?.find((ext) => ext.url === url)?.valueString;
}

function parseMedicationFallback(resource: Record<string, unknown>, id: string, op_timestamp: string): MedicationProfile | null {
  const concept = resource.medicationCodeableConcept as { text?: string } | undefined;
  const note = (resource.note as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  const text = concept?.text ?? '';
  const match = /^(.+) \((.+), (.+)\)$/.exec(text);
  if (!match) return null;

  const prescriberMatch = /Prescriber: ([^.]+)\./.exec(note);
  const conditionMatch = /Condition treated: ([^.]+)\./.exec(note);
  const scheduleMatch = /Schedule: (\{.*\})$/.exec(note);
  if (!prescriberMatch || !conditionMatch || !scheduleMatch) return null;

  try {
    const schedule = JSON.parse(scheduleMatch[1]!) as MedicationSchedule;
    return {
      id,
      op_timestamp,
      drugName: match[1]!,
      prescribingPhysician: prescriberMatch[1]!,
      conditionTreated: conditionMatch[1]!,
      active: resource.status === 'active',
      regimens: [
        {
          id: `${id}-reg-1`,
          dosage: match[3]!,
          form: match[2]!,
          schedule,
        },
      ],
    };
  } catch {
    return null;
  }
}

function parseSymptomFallback(resource: Record<string, unknown>, id: string, op_timestamp: string): SymptomEntry | null {
  const codeText = (resource.code as { text?: string } | undefined)?.text ?? '';
  const parts = codeText.split(' — ');
  const note = (resource.note as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  const durationMatch = /Duration: (\d+) ([a-z]+)\./.exec(note);
  const notesMatch = /Notes: (.+)$/.exec(note);
  const severity = resource.valueInteger;
  if (parts.length !== 2 || typeof severity !== 'number' || !durationMatch) return null;

  const unit = durationMatch[2] as TimeUnit;
  return {
    id,
    op_timestamp,
    symptomType: parts[0]!,
    systemicLocation: parts[1]!,
    severity,
    duration: { value: Number(durationMatch[1]), unit },
    notes: notesMatch?.[1] === '(none)' ? '' : notesMatch?.[1] ?? '',
    active: resource.status === 'final',
  };
}

function parsePrnFallback(resource: Record<string, unknown>, id: string, op_timestamp: string): PrnLog | null {
  const takenAt = resource.effectiveDateTime;
  const dosageText = (resource.dosage as { text?: string } | undefined)?.text;
  if (typeof takenAt !== 'string' || !dosageText) return null;

  const override = dosageText.includes('(override)');
  const amountText = dosageText.replace(' (override)', '');
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) return null;

  const medicationId = readExtensionString(resource, `${EXPORT_SYSTEM}/medication-id`);
  if (!medicationId) return null;

  return { id, op_timestamp, medicationId, amount, takenAt, override: override || undefined };
}

function parseAssociationProvenance(
  resource: Record<string, unknown>,
  exportedAt: string,
): Association | null {
  const domain = readDomainExtension(resource);
  if (domain?.kind === 'association') {
    const id = typeof resource.id === 'string' ? resource.id.replace(/^assoc-/, '') : '';
    if (!id) return null;
    return {
      id,
      op_timestamp: typeof resource.recorded === 'string' ? resource.recorded : exportedAt,
      symptomId: domain.symptomId,
      conditionIds: domain.conditionIds,
      medicationIds: domain.medicationIds,
    };
  }

  const id = typeof resource.id === 'string' ? resource.id.replace(/^assoc-/, '') : '';
  const entity = (resource.entity as Array<{ what?: { reference?: string } }> | undefined)?.[0];
  const symptomRef = entity?.what?.reference?.replace(/^Observation\//, '');
  const conditionIds = readExtensionString(resource, `${EXPORT_SYSTEM}/condition-ids`)?.split(',').filter(Boolean) ?? [];
  const medicationIds = readExtensionString(resource, `${EXPORT_SYSTEM}/medication-ids`)?.split(',').filter(Boolean) ?? [];
  if (!id || !symptomRef) return null;

  return {
    id,
    op_timestamp: typeof resource.recorded === 'string' ? resource.recorded : exportedAt,
    symptomId: symptomRef,
    conditionIds,
    medicationIds,
  };
}

function isAssociationProvenance(resource: Record<string, unknown>): boolean {
  if (resource.resourceType !== 'Provenance') return false;
  const activity = resource.activity as { coding?: Array<{ code?: string }> } | undefined;
  return activity?.coding?.some((coding) => coding.code === ASSOCIATION_PROVENANCE_CODE) === true;
}

function isSymptomObservation(resource: Record<string, unknown>): boolean {
  if (resource.resourceType !== 'Observation') return false;
  const categories = resource.category as Array<{ text?: string }> | undefined;
  return categories?.some((category) => category.text === 'Symptom') === true;
}

/**
 * Parse exported FHIR resources into domain records for vault merge.
 */
export function parseFhirBundleToSource(bundle: FhirBundle): ParseFhirBundleResult {
  if (bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
    return { status: 'error', message: 'Invalid FHIR Bundle.' };
  }

  const source: ParsedClinicalImport = {
    medications: [],
    prnLogs: [],
    symptoms: [],
    conditions: [],
    flares: [],
    associations: [],
  };
  const warnings: string[] = [];
  const exportedAt = bundle.timestamp ?? new Date().toISOString();

  for (const entry of bundle.entry) {
    const resource = entry.resource;
    const resourceType = resource.resourceType;
    const id = typeof resource.id === 'string' ? resource.id : '';
    if (!id || id === 'patient-1' || id === 'export-provenance') continue;

    const op_timestamp = readMetaTimestamp(resource);
    const domain = readDomainExtension(resource);

    if (resourceType === 'MedicationStatement') {
      if (domain?.kind === 'medication') {
        const { kind: _kind, ...fields } = domain;
        source.medications.push({ id, op_timestamp, ...fields });
        continue;
      }
      const parsed = parseMedicationFallback(resource, id, op_timestamp);
      if (parsed) source.medications.push(parsed);
      else warnings.push(`Skipped medication ${id}: could not parse.`);
      continue;
    }

    if (resourceType === 'MedicationAdministration') {
      if (domain?.kind === 'prn-log') {
        const { kind: _kind, ...fields } = domain;
        source.prnLogs.push({ id, op_timestamp, ...fields });
        continue;
      }
      const parsed = parsePrnFallback(resource, id, op_timestamp);
      if (parsed) source.prnLogs.push(parsed);
      else warnings.push(`Skipped PRN log ${id}: could not parse.`);
      continue;
    }

    if (resourceType === 'Condition') {
      if (domain?.kind === 'condition') {
        source.conditions.push({ id, op_timestamp, name: domain.name });
        continue;
      }
      const name = (resource.code as { text?: string } | undefined)?.text;
      if (name) source.conditions.push({ id, op_timestamp, name });
      else warnings.push(`Skipped condition ${id}: missing name.`);
      continue;
    }

    if (isSymptomObservation(resource)) {
      if (domain?.kind === 'symptom') {
        const { kind: _kind, ...fields } = domain;
        source.symptoms.push({ id, op_timestamp, ...fields });
        continue;
      }
      const parsed = parseSymptomFallback(resource, id, op_timestamp);
      if (parsed) source.symptoms.push(parsed);
      else warnings.push(`Skipped symptom ${id}: could not parse.`);
      continue;
    }

    if (resourceType === 'Encounter') {
      if (domain?.kind === 'flare') {
        const { kind: _kind, ...fields } = domain;
        source.flares.push({ id, op_timestamp, ...fields });
        continue;
      }
      const trigger = (resource.reasonCode as Array<{ text?: string }> | undefined)?.[0]?.text;
      const symptomIds =
        readExtensionString(resource, `${EXPORT_SYSTEM}/flare-symptom-ids`)?.split(',').filter(Boolean) ?? [];
      if (trigger && symptomIds.length >= 2) {
        source.flares.push({ id, op_timestamp, trigger, symptomIds });
      } else {
        warnings.push(`Skipped flare ${id}: could not parse.`);
      }
      continue;
    }

    if (isAssociationProvenance(resource)) {
      const parsed = parseAssociationProvenance(resource, exportedAt);
      if (parsed) source.associations.push(parsed);
      else warnings.push(`Skipped association ${id}: could not parse.`);
    }
  }

  return { status: 'ok', source, warnings };
}

export function parsedImportRecordCount(source: ParsedClinicalImport): number {
  return (
    source.medications.length +
    source.prnLogs.length +
    source.symptoms.length +
    source.conditions.length +
    source.flares.length +
    source.associations.length
  );
}

export function parsedImportToVaultRecords(source: ParsedClinicalImport): Record<string, VaultRecord[]> {
  return {
    medications: [...source.medications, ...source.prnLogs],
    symptoms: source.symptoms,
    conditions: source.conditions,
    flares: source.flares,
    associations: source.associations,
  };
}
