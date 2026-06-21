import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOSAGE_UNIT,
  formatDosageString,
  isPresetDosageUnit,
  normalizeDosageUnit,
  parseDosageString,
} from './dosage-units';

describe('parseDosageString', () => {
  it('parses amount-only strings with default unit', () => {
    expect(parseDosageString('12')).toEqual({ amount: '12', unit: DEFAULT_DOSAGE_UNIT });
    expect(parseDosageString(' 0.5 ')).toEqual({ amount: '0.5', unit: DEFAULT_DOSAGE_UNIT });
  });

  it('parses combined amount and unit strings', () => {
    expect(parseDosageString('25mg')).toEqual({ amount: '25', unit: 'mg' });
    expect(parseDosageString('25 mg')).toEqual({ amount: '25', unit: 'mg' });
    expect(parseDosageString('1 tablet')).toEqual({ amount: '1', unit: 'tablet' });
    expect(parseDosageString('10 mL')).toEqual({ amount: '10', unit: 'mL' });
  });

  it('normalizes common unit aliases', () => {
    expect(normalizeDosageUnit('tabs')).toBe('tablet');
    expect(normalizeDosageUnit('IU')).toBe('IU');
    expect(parseDosageString('100 units')).toEqual({ amount: '100', unit: 'unit' });
  });

  it('normalizes injectable unit aliases', () => {
    expect(normalizeDosageUnit('ampule')).toBe('ampoule');
    expect(normalizeDosageUnit('vials')).toBe('vial');
    expect(parseDosageString('1 ampoule')).toEqual({ amount: '1', unit: 'ampoule' });
  });

  it('preserves unrecognized free-text dosage in amount', () => {
    expect(parseDosageString('as directed')).toEqual({ amount: 'as directed', unit: DEFAULT_DOSAGE_UNIT });
  });
});

describe('formatDosageString', () => {
  it('combines amount and unit', () => {
    expect(formatDosageString('12', 'mg')).toBe('12 mg');
    expect(formatDosageString('1', 'tablet')).toBe('1 tablet');
    expect(formatDosageString('2', 'puff')).toBe('2 puff');
  });

  it('returns empty string when amount is blank', () => {
    expect(formatDosageString('', 'mg')).toBe('');
    expect(formatDosageString('  ', 'tablet')).toBe('');
  });
});

describe('isPresetDosageUnit', () => {
  it('recognizes preset units', () => {
    expect(isPresetDosageUnit('mg')).toBe(true);
    expect(isPresetDosageUnit('tablet')).toBe(true);
    expect(isPresetDosageUnit('mL')).toBe(true);
  });

  it('recognizes injectable preset units', () => {
    expect(isPresetDosageUnit('vial')).toBe(true);
    expect(isPresetDosageUnit('ampoule')).toBe(true);
  });

  it('treats uncommon units as custom', () => {
    expect(isPresetDosageUnit('puff')).toBe(false);
    expect(isPresetDosageUnit('application')).toBe(false);
  });
});
