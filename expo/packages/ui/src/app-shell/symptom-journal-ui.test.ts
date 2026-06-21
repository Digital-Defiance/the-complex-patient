import { describe, it, expect } from 'vitest';
import {
  mergeWeatherIntoTrend,
  trendHasWeatherData,
  weatherOverlayBandHeight,
  weatherOverlayValue,
} from './symptom-journal-ui';

describe('mergeWeatherIntoTrend', () => {
  it('aligns weather rows onto severity trend days', () => {
    const merged = mergeWeatherIntoTrend(
      [{ day: '2024-06-14', maxSeverity: 7, flareCount: 0, symptomCount: 1 }],
      [
        {
          day: '2024-06-14',
          meanPressureHpa: 1010,
          meanHumidityPct: 55,
          meanTemperatureC: 18,
          totalPrecipitationMm: 2.5,
          pressureDelta24h: -3,
        },
      ],
    );

    expect(merged[0]).toMatchObject({
      day: '2024-06-14',
      maxSeverity: 7,
      meanPressureHpa: 1010,
      meanTemperatureC: 18,
      totalPrecipitationMm: 2.5,
      pressureDelta24h: -3,
    });
  });
});

describe('weather overlay helpers', () => {
  const day = {
    day: '2024-06-14',
    maxSeverity: 5,
    flareCount: 0,
    symptomCount: 1,
    meanPressureHpa: 1010,
    meanHumidityPct: 80,
    meanTemperatureC: 22,
    totalPrecipitationMm: 4,
    pressureDelta24h: -6,
    meanHeatIndexC: 22,
    rapidPressureDrop: true,
  };

  it('reads overlay values by metric id', () => {
    expect(weatherOverlayValue(day, 'humidity')).toBe(80);
    expect(weatherOverlayValue(day, 'precipitation')).toBe(4);
  });

  it('detects when weather data exists on the trend', () => {
    expect(trendHasWeatherData([day])).toBe(true);
    expect(
      trendHasWeatherData([
        {
          ...day,
          meanPressureHpa: null,
          meanHumidityPct: null,
          meanTemperatureC: null,
          totalPrecipitationMm: null,
          pressureDelta24h: null,
          meanHeatIndexC: null,
          rapidPressureDrop: false,
        },
      ]),
    ).toBe(false);
  });

  it('scales band heights for overlays', () => {
    expect(weatherOverlayBandHeight(-6, 'pressureDelta24h', { min: 0, max: 0 })).toBeGreaterThan(0);
    expect(weatherOverlayBandHeight(80, 'humidity', { min: 0, max: 100 })).toBeGreaterThan(0);
  });
});
