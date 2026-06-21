import { describe, it, expect } from 'vitest';
import { createWeatherService } from './service';

describe('createWeatherService', () => {
  it('caches Open-Meteo responses per bucket and date span', async () => {
    const store = new Map<string, string>();
    let fetchCount = 0;

    const service = createWeatherService({
      cache: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          store.set(key, value);
        },
      },
      fetch: async () => {
        fetchCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            hourly: {
              time: ['2024-06-14T12:00'],
              surface_pressure: [1010],
              relative_humidity_2m: [55],
            },
          }),
        };
      },
    });

    const points = [{ latitude: 40.712776, longitude: -74.005974, isoTimestamp: '2024-06-14T12:00:00.000Z' }];
    const days = ['2024-06-14'];

    await service.loadTrendForPoints(days, points);
    await service.loadTrendForPoints(days, points);

    expect(fetchCount).toBe(1);
  });
});
