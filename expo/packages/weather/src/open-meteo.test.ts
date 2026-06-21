import { describe, it, expect } from 'vitest';
import { buildArchiveUrl, parseHourlySamples } from './open-meteo';

describe('open-meteo client', () => {
  it('buildArchiveUrl includes required hourly variables', () => {
    const url = buildArchiveUrl(40.7, -74, '2024-06-01', '2024-06-02');
    expect(url).toContain('latitude=40.7');
    expect(url).toContain('longitude=-74');
    expect(url).toContain('start_date=2024-06-01');
    expect(url).toContain('surface_pressure');
    expect(url).toContain('relative_humidity_2m');
  });

  it('parseHourlySamples normalizes arrays', () => {
    const samples = parseHourlySamples({
      hourly: {
        time: ['2024-06-01T00:00', '2024-06-01T01:00'],
        surface_pressure: [1010, 1012],
        relative_humidity_2m: [55, 57],
        temperature_2m: [20, 21],
        precipitation: [0, 0.1],
      },
    });

    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({
      time: '2024-06-01T00:00',
      surfacePressureHpa: 1010,
      relativeHumidityPct: 55,
    });
  });
});
