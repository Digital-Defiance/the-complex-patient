/** A drug concept row in the bundled naming catalog. */
export interface DrugConcept {
  rxcui: string;
  displayName: string;
  synonyms: string[];
  ingredientRxcui: string;
  ingredientName: string;
  classIds: string[];
}

/** Bundled on-device catalog (RxNorm + RxClass subset). */
export interface DrugNamingCatalog {
  version: string;
  attribution: string;
  concepts: DrugConcept[];
  /** Normalized 11-digit NDC → ingredient/clinical RxCUI */
  ndcMap: Record<string, string>;
  /** classId → human-readable class label */
  classes: Record<string, string>;
}

export interface RxMatchCandidate {
  rxcui: string;
  displayName: string;
  ingredientRxcui: string;
  ingredientName: string;
  classIds: string[];
  confidence: number;
  matchedTerm: string;
}

export interface RxMatchResult {
  candidate: RxMatchCandidate | null;
  suggestions: RxMatchCandidate[];
}

export type MedicationNamingNoticeKind = 'duplicate-ingredient' | 'same-class';

export interface MedicationNamingNotice {
  kind: MedicationNamingNoticeKind;
  message: string;
  medicationIds: string[];
  classId?: string;
  ingredientRxcui?: string;
}

/** Minimal med shape for overlap detection (avoids domain coupling). */
export interface MedicationForNamingCheck {
  id: string;
  drugName: string;
  active: boolean;
  userConfirmedRxMatch?: boolean;
  ingredientRxcui?: string;
  rxDisplayName?: string;
  classIds?: string[];
}

export interface AppliedRxIdentity {
  rxcui: string;
  ingredientRxcui: string;
  rxDisplayName: string;
  rxMatchConfidence: number;
  userConfirmedRxMatch: boolean;
  rxnormDatasetVersion: string;
  classIds: string[];
}
