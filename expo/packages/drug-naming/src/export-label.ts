import type { MedicationProfile } from '@complex-patient/domain';

/** Human-readable medication label for exports (includes confirmed generic when different). */
export function formatMedicationExportLabel(
  med: Pick<MedicationProfile, 'drugName' | 'rxDisplayName' | 'userConfirmedRxMatch' | 'rxcui'>,
): string {
  const typed = med.drugName.trim();
  if (med.userConfirmedRxMatch === true && med.rxDisplayName?.trim()) {
    const generic = med.rxDisplayName.trim();
    if (generic.toLowerCase() !== typed.toLowerCase()) {
      return `${typed} (naming database: ${generic})`;
    }
    return generic;
  }
  return typed;
}

/** Optional RxNorm annotation line for structured exports. */
export function formatMedicationRxAnnotation(
  med: Pick<MedicationProfile, 'rxcui' | 'ingredientRxcui' | 'rxnormDatasetVersion' | 'userConfirmedRxMatch'>,
): string | null {
  if (med.userConfirmedRxMatch !== true || !med.rxcui?.trim()) {
    return null;
  }
  const parts = [`RxCUI ${med.rxcui.trim()}`];
  if (med.ingredientRxcui?.trim() && med.ingredientRxcui !== med.rxcui) {
    parts.push(`ingredient ${med.ingredientRxcui.trim()}`);
  }
  if (med.rxnormDatasetVersion?.trim()) {
    parts.push(`dataset ${med.rxnormDatasetVersion.trim()}`);
  }
  return parts.join('; ');
}
