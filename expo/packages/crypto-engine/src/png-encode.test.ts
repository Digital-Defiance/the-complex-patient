import { describe, expect, it } from 'vitest';
import { encodeRgbaPng } from './png-encode';

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

describe('encodeRgbaPng', () => {
  it('writes a valid PNG header and IHDR chunk for a 2×2 RGBA image', () => {
    const rgba = Uint8Array.of(
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    );
    const png = encodeRgbaPng(2, 2, rgba);

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(png.length).toBeGreaterThan(40);
  });
});
