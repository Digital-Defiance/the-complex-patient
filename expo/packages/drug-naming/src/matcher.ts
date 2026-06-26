import { RX_MATCH_SUGGEST_THRESHOLD } from './config';
import { getConceptByRxcui, getDrugNamingCatalog, listAllSearchTerms } from './catalog';
import { normalizeDrugQuery, normalizeNdc, scoreDrugTermMatch } from './normalize';
import type { AppliedRxIdentity, DrugNamingCatalog, RxMatchCandidate, RxMatchResult } from './types';

function toCandidate(concept: import('./types').DrugConcept, confidence: number, matchedTerm: string): RxMatchCandidate {
  return {
    rxcui: concept.rxcui,
    displayName: concept.displayName,
    ingredientRxcui: concept.ingredientRxcui,
    ingredientName: concept.ingredientName,
    classIds: [...concept.classIds],
    confidence,
    matchedTerm,
  };
}

function rankConceptMatches(catalog: DrugNamingCatalog, query: string, limit: number): RxMatchCandidate[] {
  const normalizedQuery = normalizeDrugQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const bestByRxcui = new Map<string, RxMatchCandidate>();

  for (const { term, concept } of listAllSearchTerms(catalog)) {
    const confidence = scoreDrugTermMatch(normalizedQuery, term);
    if (confidence < RX_MATCH_SUGGEST_THRESHOLD) {
      continue;
    }
    const existing = bestByRxcui.get(concept.rxcui);
    const candidate = toCandidate(concept, confidence, term);
    if (!existing || candidate.confidence > existing.confidence) {
      bestByRxcui.set(concept.rxcui, candidate);
    }
  }

  return [...bestByRxcui.values()]
    .sort((a, b) => b.confidence - a.confidence || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

/** Search drug names for type-ahead (display strings). */
export function searchDrugNameSuggestions(query: string, limit = 8): string[] {
  const catalog = getDrugNamingCatalog();
  const matches = rankConceptMatches(catalog, query, limit);
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const match of matches) {
    const label = match.displayName;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels;
}

/** Match a typed drug name or NDC-resolved RxCUI to catalog concepts. */
export function matchMedicationName(
  query: string,
  options: { rxcuiHint?: string; limit?: number } = {},
): RxMatchResult {
  const catalog = getDrugNamingCatalog();
  const limit = options.limit ?? 6;

  if (options.rxcuiHint) {
    const concept = getConceptByRxcui(catalog, options.rxcuiHint);
    if (concept) {
      const candidate = toCandidate(concept, 1, concept.displayName);
      return { candidate, suggestions: [candidate] };
    }
  }

  const suggestions = rankConceptMatches(catalog, query, limit);
  return {
    candidate: suggestions[0] ?? null,
    suggestions,
  };
}

/** Build persisted Rx identity fields after user confirms a match. */
export function buildConfirmedRxIdentity(candidate: RxMatchCandidate): AppliedRxIdentity {
  return {
    rxcui: candidate.rxcui,
    ingredientRxcui: candidate.ingredientRxcui,
    rxDisplayName: candidate.displayName,
    rxMatchConfidence: candidate.confidence,
    userConfirmedRxMatch: true,
    rxnormDatasetVersion: getDrugNamingCatalog().version,
    classIds: [...candidate.classIds],
  };
}

/** Clear Rx identity when user declines or is unsure. */
export function buildDeclinedRxIdentity(): Pick<AppliedRxIdentity, 'userConfirmedRxMatch' | 'rxnormDatasetVersion'> {
  return {
    userConfirmedRxMatch: false,
    rxnormDatasetVersion: getDrugNamingCatalog().version,
  };
}

/** Resolve NDC to RxCUI via catalog map. */
export function resolveRxcuiFromNdc(productCode: string): string | null {
  const catalog = getDrugNamingCatalog();
  const ndc = normalizeNdc(productCode);
  if (!ndc) return null;
  return catalog.ndcMap[ndc] ?? null;
}
