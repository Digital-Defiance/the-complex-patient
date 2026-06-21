/**
 * Build daily weather aggregates aligned to journal history trend days.
 */

import type { WeatherHourlySample, WeatherTrendDay } from './ports';
import { calendarDayKey } from './geo';
import { resolveDayLocationBucket } from './capture';
import { heatIndexC, isRapidPressureDrop } from './metrics';

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function samplesForDay(samples: readonly WeatherHourlySample[], day: string): WeatherHourlySample[] {
  return samples.filter((sample) => calendarDayKey(sample.time) === day);
}

function pressureDelta24h(samples: readonly WeatherHourlySample[], day: string): number | null {
  const daySamples = samplesForDay(samples, day).filter((s) => s.surfacePressureHpa !== null);
  if (daySamples.length === 0) {
    return null;
  }

  const dayStartMs = Date.parse(`${day}T00:00:00Z`);
  const priorStartMs = dayStartMs - 24 * 60 * 60 * 1000;
  const priorEndMs = dayStartMs;

  const priorPressures: number[] = [];
  const dayPressures = daySamples
    .map((s) => s.surfacePressureHpa)
    .filter((v): v is number => v !== null);

  for (const sample of samples) {
    if (sample.surfacePressureHpa === null) continue;
    const ms = Date.parse(sample.time.includes('T') ? `${sample.time}Z` : `${sample.time}:00Z`);
    if (ms >= priorStartMs && ms < priorEndMs) {
      priorPressures.push(sample.surfacePressureHpa);
    }
  }

  const priorMean = mean(priorPressures);
  const dayMean = mean(dayPressures);
  if (priorMean === null || dayMean === null) {
    return null;
  }
  return dayMean - priorMean;
}

export function buildWeatherTrendDays(
  days: readonly string[],
  samples: readonly WeatherHourlySample[],
): WeatherTrendDay[] {
  return days.map((day) => {
    const daySamples = samplesForDay(samples, day);
    const pressures = daySamples
      .map((s) => s.surfacePressureHpa)
      .filter((v): v is number => v !== null);
    const humidities = daySamples
      .map((s) => s.relativeHumidityPct)
      .filter((v): v is number => v !== null);
    const temperatures = daySamples
      .map((s) => s.temperatureC)
      .filter((v): v is number => v !== null);
    const precipitations = daySamples
      .map((s) => s.precipitationMm)
      .filter((v): v is number => v !== null);

    const meanTemperatureC = mean(temperatures);
    const meanHumidityPct = mean(humidities);
    const pressureDelta = pressureDelta24h(samples, day);
    const meanHeatIndexC =
      meanTemperatureC !== null && meanHumidityPct !== null
        ? heatIndexC(meanTemperatureC, meanHumidityPct)
        : null;

    return {
      day,
      meanPressureHpa: mean(pressures),
      meanHumidityPct,
      meanTemperatureC,
      totalPrecipitationMm:
        precipitations.length > 0
          ? precipitations.reduce((sum, value) => sum + value, 0)
          : null,
      pressureDelta24h: pressureDelta,
      meanHeatIndexC,
      rapidPressureDrop: isRapidPressureDrop(pressureDelta),
    };
  });
}

export function buildWeatherTrendDaysForLocations(
  days: readonly string[],
  points: readonly { latitude: number; longitude: number; isoTimestamp: string }[],
  samplesByBucket: ReadonlyMap<string, readonly WeatherHourlySample[]>,
): WeatherTrendDay[] {
  return days.map((day) => {
    const bucket = resolveDayLocationBucket(day, points);
    if (bucket === null) {
      return emptyWeatherTrendDay(day);
    }
    const samples = [...(samplesByBucket.get(bucket) ?? [])];
    return buildWeatherTrendDays([day], samples)[0] ?? emptyWeatherTrendDay(day);
  });
}

function emptyWeatherTrendDay(day: string): WeatherTrendDay {
  return {
    day,
    meanPressureHpa: null,
    meanHumidityPct: null,
    meanTemperatureC: null,
    totalPrecipitationMm: null,
    pressureDelta24h: null,
    meanHeatIndexC: null,
    rapidPressureDrop: false,
  };
}
