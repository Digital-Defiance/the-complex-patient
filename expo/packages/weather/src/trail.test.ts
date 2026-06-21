import { describe, it, expect } from 'vitest';
import {
  buildLocationTrailSample,
  locationPointsFromTrailSamples,
  pruneTrailSamples,
  shouldAppendTrailSample,
} from './trail';

describe('location trail helpers', () => {
  it('dedupes samples within the minimum interval', () => {
    const existing = [
      buildLocationTrailSample({
        id: '1',
        opTimestamp: '2024-06-01T12:00:00.000Z',
        latitude: 1,
        longitude: 2,
        capturedAt: '2024-06-01T12:00:00.000Z',
      }),
    ];

    expect(shouldAppendTrailSample(existing, '2024-06-01T12:10:00.000Z')).toBe(false);
    expect(shouldAppendTrailSample(existing, '2024-06-01T13:00:00.000Z')).toBe(true);
  });

  it('prunes samples older than retention window', () => {
    const samples = [
      buildLocationTrailSample({
        id: 'old',
        opTimestamp: '2024-01-01T12:00:00.000Z',
        latitude: 1,
        longitude: 2,
        capturedAt: '2024-01-01T12:00:00.000Z',
      }),
      buildLocationTrailSample({
        id: 'new',
        opTimestamp: '2024-06-01T12:00:00.000Z',
        latitude: 1,
        longitude: 2,
        capturedAt: '2024-06-01T12:00:00.000Z',
      }),
    ];

    const pruned = pruneTrailSamples(samples, 30, new Date('2024-06-15T12:00:00.000Z'));
    expect(pruned.map((sample) => sample.id)).toEqual(['new']);
  });

  it('converts trail samples to location time points', () => {
    const points = locationPointsFromTrailSamples([
      {
        latitude: 40.1,
        longitude: -74.2,
        capturedAt: '2024-06-01T08:00:00.000Z',
      },
    ]);
    expect(points).toEqual([
      { latitude: 40.1, longitude: -74.2, isoTimestamp: '2024-06-01T08:00:00.000Z' },
    ]);
  });
});
