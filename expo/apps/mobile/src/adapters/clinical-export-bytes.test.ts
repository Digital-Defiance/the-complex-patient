/**
 * Clinical export byte helper tests.
 */

import { describe, expect, it } from 'vitest';
import { base64ToUint8Array, uint8ArrayToBase64 } from './clinical-export-bytes';

describe('clinical export byte helpers', () => {
  it('round-trips zip bytes through base64', () => {
    const original = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    const encoded = uint8ArrayToBase64(original);
    const decoded = base64ToUint8Array(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
