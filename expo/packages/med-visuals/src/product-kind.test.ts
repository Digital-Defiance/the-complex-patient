import { describe, expect, it } from 'vitest';
import { hasCustomizableMedAppearance, resolveMedProductKind } from './product-kind';

describe('resolveMedProductKind', () => {
  it('detects spray from form or unit', () => {
    expect(resolveMedProductKind('nasal spray', 'mL')).toBe('spray');
    expect(resolveMedProductKind('solution', 'spray')).toBe('spray');
  });

  it('detects vial from form or unit', () => {
    expect(resolveMedProductKind('injection', 'vial')).toBe('vial');
    expect(resolveMedProductKind('insulin vial', 'mL')).toBe('vial');
    expect(resolveMedProductKind('subcutaneous injection', '')).toBe('vial');
  });

  it('detects ampoule from form or unit', () => {
    expect(resolveMedProductKind('injectable', 'ampoule')).toBe('ampoule');
    expect(resolveMedProductKind('glass ampule', 'mL')).toBe('ampoule');
  });

  it('detects patch from form or unit', () => {
    expect(resolveMedProductKind('transdermal patch', 'mg')).toBe('patch');
    expect(resolveMedProductKind('tablet', 'patch')).toBe('patch');
  });

  it('detects drop from form or unit', () => {
    expect(resolveMedProductKind('ophthalmic solution', 'drop')).toBe('drop');
    expect(resolveMedProductKind('otic drops', 'mL')).toBe('drop');
  });

  it('uses generic icon for unit dose and custom units', () => {
    expect(resolveMedProductKind('insulin', 'unit')).toBe('generic');
    expect(resolveMedProductKind('inhaler', 'puff')).toBe('generic');
    expect(resolveMedProductKind('cream', 'application')).toBe('generic');
  });

  it('defaults to pill for tablets and strength units', () => {
    expect(resolveMedProductKind('tablet', 'mg')).toBe('pill');
    expect(resolveMedProductKind('', 'capsule')).toBe('pill');
  });
});

describe('hasCustomizableMedAppearance', () => {
  it('is false only for generic', () => {
    expect(hasCustomizableMedAppearance('generic')).toBe(false);
    expect(hasCustomizableMedAppearance('pill')).toBe(true);
    expect(hasCustomizableMedAppearance('patch')).toBe(true);
  });
});
