import { describe, expect, it } from 'vitest';
import { extractProductCodeFromBarcode } from '@complex-patient/drug-naming';

describe('MedProductCodeScanner fallback contract', () => {
  it('normalizes barcode payloads the native scanner would pass through', () => {
    expect(extractProductCodeFromBarcode('00305730515070')).toBe('00305730515070');
    expect(extractProductCodeFromBarcode('00573-0150-70')).toBe('00573-0150-70');
    expect(extractProductCodeFromBarcode('short')).toBe('short');
  });
});
