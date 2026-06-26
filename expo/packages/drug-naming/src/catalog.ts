import catalogJson from '../data/rxnorm-catalog.json';
import type { DrugConcept, DrugNamingCatalog } from './types';

let cachedCatalog: DrugNamingCatalog | null = null;

/** Load the bundled catalog (singleton). */
export function getDrugNamingCatalog(): DrugNamingCatalog {
  if (cachedCatalog === null) {
    cachedCatalog = catalogJson as DrugNamingCatalog;
  }
  return cachedCatalog;
}

/** @internal test hook */
export function setDrugNamingCatalogForTests(catalog: DrugNamingCatalog | null): void {
  cachedCatalog = catalog;
}

export function getConceptByRxcui(catalog: DrugNamingCatalog, rxcui: string): DrugConcept | undefined {
  return catalog.concepts.find((concept) => concept.rxcui === rxcui);
}

export function getClassLabel(catalog: DrugNamingCatalog, classId: string): string {
  return catalog.classes[classId] ?? classId;
}

export function listAllSearchTerms(catalog: DrugNamingCatalog): Array<{ term: string; concept: DrugConcept }> {
  const rows: Array<{ term: string; concept: DrugConcept }> = [];
  for (const concept of catalog.concepts) {
    rows.push({ term: concept.displayName, concept });
    for (const synonym of concept.synonyms) {
      rows.push({ term: synonym, concept });
    }
  }
  return rows;
}

export function getDatasetVersion(): string {
  return getDrugNamingCatalog().version;
}

export function getDatasetAttribution(): string {
  return getDrugNamingCatalog().attribution;
}
