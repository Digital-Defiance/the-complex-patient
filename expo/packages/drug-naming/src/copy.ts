/** Persistent footer on the medications hub. */
export const MEDICATION_NAMING_DISCLAIMER =
  'Medication tools help you organize your own records. They are not medical advice and not a substitute for a pharmacist, prescriber, or emergency care. Information may be incomplete or wrong. Always confirm medications with a qualified professional.';

export const MEDICATION_NAMING_ATTRIBUTION =
  'Drug names from RxNorm, National Library of Medicine (NIH). US-focused naming data; may not cover all products internationally.';

export function duplicateIngredientNoticeMessage(displayName: string, entries: readonly string[]): string {
  const list = entries.join(', ');
  return `These entries appear to name the same ingredient (${displayName}) in our drug naming database: ${list}. That might be intentional (different schedules) or a duplicate. Only you and your care team can know — consider confirming your list with your pharmacist.`;
}

export function sameClassNoticeMessage(className: string, entries: readonly string[]): string {
  const list = entries.join(', ');
  return `Our naming database groups these medications in the same class (${className}): ${list}. Some people discuss overlapping medications in a class with their pharmacist or prescriber. This is informational only, not medical advice.`;
}

export const UNIDENTIFIED_MEDICATION_NOTE =
  'We could not match this name to our on-device drug list, so automated grouping checks were not run for this entry.';

export const RX_MATCH_CONFIRM_PROMPT = (displayName: string, typedName: string): string =>
  `Is ${typedName.trim() || 'this entry'} the same as ${displayName} in our drug naming database?`;
