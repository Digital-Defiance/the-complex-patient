import { describe, it, expect } from 'vitest';
import { heatIndexC, isRapidPressureDrop } from './metrics';

describe('heatIndexC', () => {
  it('returns temperature when below heat-index threshold', () => {
    expect(heatIndexC(20, 50)).toBe(20);
  });

  it('computes elevated heat index for hot humid conditions', () => {
    const hi = heatIndexC(32, 70);
    expect(hi).not.toBeNull();
    expect(hi!).toBeGreaterThan(32);
  });
});

describe('isRapidPressureDrop', () => {
  it('flags drops of 6 hPa or more in 24h', () => {
    expect(isRapidPressureDrop(-6)).toBe(true);
    expect(isRapidPressureDrop(-5.9)).toBe(false);
    expect(isRapidPressureDrop(null)).toBe(false);
  });
});
