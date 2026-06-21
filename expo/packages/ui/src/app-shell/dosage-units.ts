/** Common medication strength / dose units for selectors. */
export const DOSAGE_UNITS = [
  'mg',
  'mcg',
  'g',
  'mL',
  'IU',
  'tablet',
  'capsule',
  'patch',
  'spray',
  'vial',
  'ampoule',
  'drop',
  'unit',
] as const;

export type DosageUnit = (typeof DOSAGE_UNITS)[number];

export const DEFAULT_DOSAGE_UNIT: DosageUnit = 'mg';

const UNIT_ALIASES: Record<string, DosageUnit | 'IU'> = {
  mg: 'mg',
  mcg: 'mcg',
  µg: 'mcg',
  ug: 'mcg',
  g: 'g',
  ml: 'mL',
  tab: 'tablet',
  tabs: 'tablet',
  tablet: 'tablet',
  tablets: 'tablet',
  cap: 'capsule',
  caps: 'capsule',
  capsule: 'capsule',
  capsules: 'capsule',
  patch: 'patch',
  patches: 'patch',
  spray: 'spray',
  vial: 'vial',
  vials: 'vial',
  ampoule: 'ampoule',
  ampule: 'ampoule',
  ampoules: 'ampoule',
  drop: 'drop',
  drops: 'drop',
  unit: 'unit',
  units: 'unit',
  iu: 'IU',
};

const DOSAGE_AMOUNT_PATTERN = /^([\d]+(?:\.\d+)?)\s*(.*)$/;

export function normalizeDosageUnit(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_DOSAGE_UNIT;
  }
  const alias = UNIT_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}

export function parseDosageString(dosage: string): { amount: string; unit: string } {
  const trimmed = dosage.trim();
  if (!trimmed) {
    return { amount: '', unit: DEFAULT_DOSAGE_UNIT };
  }

  const match = trimmed.match(DOSAGE_AMOUNT_PATTERN);
  if (!match) {
    return { amount: trimmed, unit: DEFAULT_DOSAGE_UNIT };
  }

  const amount = match[1];
  const rawUnit = match[2]?.trim() ?? '';
  return {
    amount,
    unit: rawUnit ? normalizeDosageUnit(rawUnit) : DEFAULT_DOSAGE_UNIT,
  };
}

export function formatDosageString(amount: string, unit: string): string {
  const trimmedAmount = amount.trim();
  if (!trimmedAmount) {
    return '';
  }
  const trimmedUnit = unit.trim() || DEFAULT_DOSAGE_UNIT;
  return `${trimmedAmount} ${trimmedUnit}`;
}

export function isPresetDosageUnit(unit: string): boolean {
  const normalized = normalizeDosageUnit(unit);
  return (DOSAGE_UNITS as readonly string[]).includes(normalized);
}
