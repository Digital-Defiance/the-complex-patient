/** FHIR export namespace for Complex Patient extensions and provenance. */
export const EXPORT_SYSTEM = 'https://thecomplexpatient.com/fhir/export';

/** JSON domain payload extension for lossless export/import round-trip. */
export const DOMAIN_EXTENSION_URL = `${EXPORT_SYSTEM}/domain-v1`;

export const EXPORT_PROVENANCE_CODE = 'clinical-export';
export const ASSOCIATION_PROVENANCE_CODE = 'symptom-association';
