/**
 * Detect product form for icons and appearance pickers.
 */

export type MedProductKind =
  | 'pill'
  | 'spray'
  | 'vial'
  | 'ampoule'
  | 'patch'
  | 'drop'
  | 'generic';

/** Dose units that keep the pill shape / color picker (strength or tablet counts). */
const PILL_DOSE_UNITS = new Set([
  'mg',
  'mcg',
  'g',
  'ml',
  'iu',
  'tablet',
  'tablets',
  'capsule',
  'capsules',
]);

const CONTAINER_DOSE_UNITS = new Set(['patch', 'patches', 'spray', 'vial', 'vials', 'ampoule', 'ampule', 'drop', 'drops']);

export function resolveMedProductKind(form: string, dosageUnit?: string): MedProductKind {
  const normalizedForm = form.trim().toLowerCase();
  const normalizedUnit = dosageUnit?.trim().toLowerCase() ?? '';

  if (normalizedForm.includes('spray') || normalizedUnit === 'spray') {
    return 'spray';
  }

  if (
    normalizedUnit === 'ampoule' ||
    normalizedUnit === 'ampule' ||
    normalizedForm.includes('ampoule') ||
    normalizedForm.includes('ampule')
  ) {
    return 'ampoule';
  }

  if (
    normalizedUnit === 'vial' ||
    normalizedForm.includes('vial') ||
    normalizedForm.includes('injectable') ||
    normalizedForm.includes('injection') ||
    normalizedForm.includes('subcutaneous') ||
    normalizedForm.includes('intramuscular')
  ) {
    return 'vial';
  }

  if (normalizedForm.includes('patch') || normalizedUnit === 'patch' || normalizedUnit === 'patches') {
    return 'patch';
  }

  if (
    normalizedForm.includes('drop') ||
    normalizedUnit === 'drop' ||
    normalizedUnit === 'drops' ||
    normalizedForm.includes('ophthalmic') ||
    normalizedForm.includes('otic')
  ) {
    return 'drop';
  }

  if (normalizedUnit === 'unit' || normalizedUnit === 'units') {
    return 'generic';
  }

  if (normalizedUnit && !PILL_DOSE_UNITS.has(normalizedUnit) && !CONTAINER_DOSE_UNITS.has(normalizedUnit)) {
    return 'generic';
  }

  return 'pill';
}

export function hasCustomizableMedAppearance(kind: MedProductKind): boolean {
  return kind !== 'generic';
}

export function isSprayMedication(form: string, dosageUnit?: string): boolean {
  return resolveMedProductKind(form, dosageUnit) === 'spray';
}

export function isVialMedication(form: string, dosageUnit?: string): boolean {
  return resolveMedProductKind(form, dosageUnit) === 'vial';
}

export function isAmpouleMedication(form: string, dosageUnit?: string): boolean {
  return resolveMedProductKind(form, dosageUnit) === 'ampoule';
}

export function isNonPillMedication(form: string, dosageUnit?: string): boolean {
  return resolveMedProductKind(form, dosageUnit) !== 'pill';
}
