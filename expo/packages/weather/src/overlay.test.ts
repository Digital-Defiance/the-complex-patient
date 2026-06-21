import { describe, it, expect } from 'vitest';
import { buildWeatherTrendDays } from './overlay';
import type { WeatherHourlySample } from './ports';

describe('buildWeatherTrendDays', () => {
  it('computes daily means and 24h pressure delta', () => {
    const samples: WeatherHourlySample[] = [
      { time: '2024-06-13T12:00', surfacePressureHpa: 1000, relativeHumidityPct: 50, temperatureC: 20, precipitationMm: 0 },
      { time: '2024-06-14T00:00', surfacePressureHpa: 1005, relativeHumidityPct: 60, temperatureC: 21, precipitationMm: 0 },
      { time: '2024-06-14T12:00', surfacePressureHpa: 1015, relativeHumidityPct: 70, temperatureC: 22, precipitationMm: 0 },
    ];

    const days = buildWeatherTrendDays(['2024-06-14'], samples);
    expect(days[0]?.meanPressureHpa).toBe(1010);
    expect(days[0]?.meanHumidityPct).toBe(65);
    expect(days[0]?.meanTemperatureC).toBe(21.5);
    expect(days[0]?.totalPrecipitationMm).toBe(0);
    expect(days[0]?.pressureDelta24h).toBe(10);
    expect(days[0]?.rapidPressureDrop).toBe(false);
    expect(days[0]?.meanHeatIndexC).toBe(21.5);
  });
});
