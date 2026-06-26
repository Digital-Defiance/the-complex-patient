import { duplicateIngredientNoticeMessage, sameClassNoticeMessage } from './copy';
import { getClassLabel, getDrugNamingCatalog } from './catalog';
import type { MedicationForNamingCheck, MedicationNamingNotice } from './types';

function isEligibleForNotices(med: MedicationForNamingCheck): boolean {
  return med.active && med.userConfirmedRxMatch === true && Boolean(med.ingredientRxcui);
}

function displayLabel(med: MedicationForNamingCheck): string {
  return med.rxDisplayName?.trim() || med.drugName.trim();
}

/** Compute informational notices for confirmed, active medications. */
export function buildMedicationNamingNotices(
  medications: readonly MedicationForNamingCheck[],
): MedicationNamingNotice[] {
  const catalog = getDrugNamingCatalog();
  const eligible = medications.filter(isEligibleForNotices);
  const notices: MedicationNamingNotice[] = [];

  const byIngredient = new Map<string, MedicationForNamingCheck[]>();
  for (const med of eligible) {
    const key = med.ingredientRxcui!;
    const group = byIngredient.get(key) ?? [];
    group.push(med);
    byIngredient.set(key, group);
  }

  for (const [ingredientRxcui, group] of byIngredient) {
    if (group.length < 2) continue;
    const displayName = group[0]?.rxDisplayName ?? group[0]?.drugName ?? 'this ingredient';
    notices.push({
      kind: 'duplicate-ingredient',
      ingredientRxcui,
      medicationIds: group.map((med) => med.id),
      message: duplicateIngredientNoticeMessage(
        displayName,
        group.map((med) => `${displayLabel(med)} (${med.drugName})`),
      ),
    });
  }

  const classMembers = new Map<string, MedicationForNamingCheck[]>();
  for (const med of eligible) {
    for (const classId of med.classIds ?? []) {
      const group = classMembers.get(classId) ?? [];
      group.push(med);
      classMembers.set(classId, group);
    }
  }

  for (const [classId, group] of classMembers) {
    const uniqueById = [...new Map(group.map((med) => [med.id, med])).values()];
    if (uniqueById.length < 2) continue;

    const ingredientKeys = new Set(uniqueById.map((med) => med.ingredientRxcui));
    if (ingredientKeys.size < 2) continue;

    notices.push({
      kind: 'same-class',
      classId,
      medicationIds: uniqueById.map((med) => med.id),
      message: sameClassNoticeMessage(
        getClassLabel(catalog, classId),
        uniqueById.map((med) => displayLabel(med)),
      ),
    });
  }

  return notices.sort((a, b) => a.kind.localeCompare(b.kind));
}

/** Map a medication profile to naming-check fields (includes classIds from catalog when confirmed). */
export function medicationForNamingCheck(med: {
  id: string;
  drugName: string;
  active: boolean;
  userConfirmedRxMatch?: boolean;
  ingredientRxcui?: string;
  rxDisplayName?: string;
  rxcui?: string;
}): MedicationForNamingCheck {
  const catalog = getDrugNamingCatalog();
  let classIds: string[] | undefined;
  if (med.userConfirmedRxMatch && med.rxcui) {
    const concept = catalog.concepts.find((row) => row.rxcui === med.rxcui);
    classIds = concept?.classIds;
  }
  return {
    id: med.id,
    drugName: med.drugName,
    active: med.active,
    userConfirmedRxMatch: med.userConfirmedRxMatch,
    ingredientRxcui: med.ingredientRxcui,
    rxDisplayName: med.rxDisplayName,
    classIds,
  };
}
