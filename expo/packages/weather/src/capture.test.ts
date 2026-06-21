import { describe, it, expect } from 'vitest';
import { locationPointsForWeather } from './capture';

describe('locationPointsForWeather', () => {
  it('merges journal events and trail samples', () => {
    const points = locationPointsForWeather({
      symptoms: [
        {
          op_timestamp: '2024-06-01T10:00:00.000Z',
          location: { latitude: 40, longitude: -74, capturedAt: '2024-06-01T10:00:00.000Z' },
        },
      ],
      flares: [],
      prnLogs: [],
      trailSamples: [
        { latitude: 41, longitude: -73, capturedAt: '2024-06-01T12:00:00.000Z' },
      ],
    });

    expect(points).toHaveLength(2);
    expect(points[0]?.isoTimestamp).toBe('2024-06-01T10:00:00.000Z');
    expect(points[1]?.isoTimestamp).toBe('2024-06-01T12:00:00.000Z');
  });
});
