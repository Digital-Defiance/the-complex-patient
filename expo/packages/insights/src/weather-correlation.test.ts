import { describe, it, expect } from 'vitest';
import type { SymptomEntry } from '@complex-patient/domain';
import type { WeatherTrendDay } from '@complex-patient/weather';
import { detectWeatherCorrelations } from './weather-correlation';

function symptom(day: string, type: string, severity: number): SymptomEntry {
  return {
    id: `${type}-${day}`,
    op_timestamp: `${day}T12:00:00.000Z`,
    symptomType: type,
    systemicLocation: 'head',
    severity,
    duration: { value: 1, unit: 'hours' },
    notes: '',
    active: true,
  };
}

function weatherDay(day: string, pressureDelta24h: number): WeatherTrendDay {
  return {
    day,
    meanPressureHpa: 1010,
    meanHumidityPct: 50,
    meanTemperatureC: 20,
    totalPrecipitationMm: 0,
    pressureDelta24h,
    meanHeatIndexC: 20,
    rapidPressureDrop: pressureDelta24h <= -6,
  };
}

describe('detectWeatherCorrelations', () => {
  it('returns insufficient-data when history is too short', () => {
    const result = detectWeatherCorrelations([], [], {
      clock: { now: () => new Date('2024-06-30T12:00:00.000Z') },
    });
    expect(result.status).toBe('insufficient-data');
  });

  it('detects a significant pressure correlation when data is aligned', () => {
    const symptoms: SymptomEntry[] = [];
    const weatherDays: WeatherTrendDay[] = [];
    for (let day = 1; day <= 20; day += 1) {
      const key = `2024-06-${String(day).padStart(2, '0')}`;
      const pressureDelta = day % 2 === 0 ? -8 : 2;
      symptoms.push(symptom(key, 'Headache', day % 2 === 0 ? 8 : 3));
      weatherDays.push(weatherDay(key, pressureDelta));
    }

    const result = detectWeatherCorrelations(symptoms, weatherDays, {
      significanceThreshold: 0.2,
      clock: { now: () => new Date('2024-06-30T12:00:00.000Z') },
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.cards.length).toBeGreaterThan(0);
      expect(result.correlations[0]?.weatherVariable).toBe('pressureDelta24h');
    }
  });
});
