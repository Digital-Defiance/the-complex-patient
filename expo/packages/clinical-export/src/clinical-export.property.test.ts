/**
 * Property-based tests for clinical export safety and round-trip integrity.
 *
 * Property 1: Exported JSON never contains vault encryption artifacts.
 * Property 2: Active record ids appear exactly once in the FHIR bundle.
 * Property 3: Export → unpack round-trip preserves bundle resource ids.
 *
 * Validates: clinical-export Requirements 1.3, 2.2; v2 testing plan.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type {
  Association,
  Condition,
  FlareUp,
  MedicationProfile,
  PrnLog,
  SymptomEntry,
  TimeUnit,
} from '@complex-patient/domain';
import {
  assertNoVaultArtifacts,
  buildFhirBundle,
  collectBundleResourceIds,
  createClinicalExport,
  expectedExportResourceIds,
  serializeFhirJson,
  unpackExportZip,
  type ClinicalExportSource,
} from './index';

const isoTimestampArb = fc
  .integer({ min: 1577836800000, max: 1924905600000 })
  .map((ts) => new Date(ts).toISOString());

const idArb = fc.uuid();
const timeUnitArb = fc.constantFrom<TimeUnit>('minutes', 'hours', 'days', 'weeks');
const labelArb = fc
  .array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'm', 'n', 'p', 's', 't'), {
    minLength: 1,
    maxLength: 12,
  })
  .map((chars) => chars.join(''));

function withOptionalDelete<T extends { deleted?: boolean }>(base: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return base.chain((record) => fc.constantFrom(record, { ...record, deleted: true }));
}

const medicationArb: fc.Arbitrary<MedicationProfile> = fc.record({
  id: idArb,
  op_timestamp: isoTimestampArb,
  drugName: labelArb,
  dosage: labelArb,
  form: labelArb,
  prescribingPhysician: labelArb,
  conditionTreated: labelArb,
  active: fc.boolean(),
  schedule: fc.constant({ kind: 'prn' } as MedicationProfile['schedule']),
});

const prnLogArb: fc.Arbitrary<PrnLog> = fc.record({
  id: idArb,
  op_timestamp: isoTimestampArb,
  medicationId: idArb,
  amount: fc.integer({ min: 1, max: 1000 }).map((n) => n / 100),
  takenAt: isoTimestampArb,
});

const symptomArb: fc.Arbitrary<SymptomEntry> = fc.record({
  id: idArb,
  op_timestamp: isoTimestampArb,
  symptomType: labelArb,
  systemicLocation: labelArb,
  severity: fc.integer({ min: 1, max: 10 }),
  duration: fc.record({
    value: fc.integer({ min: 1, max: 100 }),
    unit: timeUnitArb,
  }),
  notes: labelArb,
  active: fc.boolean(),
});

const conditionArb: fc.Arbitrary<Condition> = fc.record({
  id: idArb,
  op_timestamp: isoTimestampArb,
  name: labelArb,
});

const flareArb: fc.Arbitrary<FlareUp> = fc.record({
  id: idArb,
  op_timestamp: isoTimestampArb,
  symptomIds: fc.array(idArb, { minLength: 2, maxLength: 5 }),
  trigger: labelArb,
});

const associationArb: fc.Arbitrary<Association> = fc.record({
  id: idArb,
  op_timestamp: isoTimestampArb,
  symptomId: idArb,
  conditionIds: fc.array(idArb, { minLength: 1, maxLength: 3 }),
  medicationIds: fc.array(idArb, { minLength: 0, maxLength: 3 }),
});

const clinicalExportSourceArb: fc.Arbitrary<ClinicalExportSource> = fc.record({
  medications: fc.array(withOptionalDelete(medicationArb), { maxLength: 8 }),
  prnLogs: fc.array(withOptionalDelete(prnLogArb), { maxLength: 8 }),
  symptoms: fc.array(withOptionalDelete(symptomArb), { maxLength: 8 }),
  conditions: fc.array(withOptionalDelete(conditionArb), { maxLength: 8 }),
  flares: fc.array(withOptionalDelete(flareArb), { maxLength: 8 }),
  associations: fc.array(withOptionalDelete(associationArb), { maxLength: 8 }),
});

const exportPasswordArb = fc.string({ minLength: 8, maxLength: 32 });
const exportedAtArb = isoTimestampArb;

describe('Property 1: Exported JSON never contains vault encryption artifacts (1.3)', () => {
  it.prop([clinicalExportSourceArb, exportedAtArb], { numRuns: 100 })(
    'serialized FHIR JSON is free of forbidden vault/crypto tokens',
    (source, exportedAt) => {
      const json = serializeFhirJson(buildFhirBundle(source, exportedAt));
      expect(() => assertNoVaultArtifacts(json)).not.toThrow();
    },
  );
});

describe('Property 2: Active record ids appear exactly once in the FHIR bundle', () => {
  it.prop([clinicalExportSourceArb, exportedAtArb], { numRuns: 100 })(
    'bundle resource ids match the active export source ids',
    (source, exportedAt) => {
      const bundle = buildFhirBundle(source, exportedAt);
      const actual = collectBundleResourceIds(bundle);
      const expected = expectedExportResourceIds(source);

      expect(actual.size).toBe(expected.size);
      for (const id of expected) {
        expect(actual.has(id)).toBe(true);
      }
    },
  );
});

describe('Property 3: Export → unpack round-trip preserves bundle resource ids (v2)', () => {
  it.prop([clinicalExportSourceArb, exportPasswordArb, exportedAtArb], { numRuns: 50 })(
    'unpacking an export zip reproduces the same resource id set',
    async (source, zipPassword, exportedAt) => {
      const exported = await createClinicalExport({ source, zipPassword, exportedAt });
      expect(exported.status).toBe('ok');
      if (exported.status !== 'ok') return;

      const unpacked = await unpackExportZip({ zipBytes: exported.zipBytes, zipPassword });
      expect(unpacked.status).toBe('ok');
      if (unpacked.status !== 'ok') return;

      const originalIds = collectBundleResourceIds(exported.bundle);
      const roundTripIds = collectBundleResourceIds(unpacked.bundle);
      expect(roundTripIds.size).toBe(originalIds.size);
      for (const id of originalIds) {
        expect(roundTripIds.has(id)).toBe(true);
      }
    },
  );
});
