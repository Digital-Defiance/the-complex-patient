/**
 * Open-Meteo Historical Weather API client (ERA5 reanalysis).
 * https://open-meteo.com/en/docs/historical-weather-api
 */

import type { FetchLike, WeatherHourlySample } from './ports';
import { locationBucketKey } from './geo';

export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

export interface OpenMeteoArchiveResponse {
  hourly?: {
    time?: string[];
    surface_pressure?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
    temperature_2m?: (number | null)[];
    precipitation?: (number | null)[];
  };
}

export function buildArchiveUrl(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    hourly: 'surface_pressure,relative_humidity_2m,temperature_2m,precipitation',
    timezone: 'UTC',
  });
  return `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`;
}

export function parseHourlySamples(payload: OpenMeteoArchiveResponse): WeatherHourlySample[] {
  const hourly = payload.hourly;
  if (!hourly?.time) {
    return [];
  }

  const samples: WeatherHourlySample[] = [];
  for (let i = 0; i < hourly.time.length; i += 1) {
    samples.push({
      time: hourly.time[i] ?? '',
      surfacePressureHpa: readNumber(hourly.surface_pressure, i),
      relativeHumidityPct: readNumber(hourly.relative_humidity_2m, i),
      temperatureC: readNumber(hourly.temperature_2m, i),
      precipitationMm: readNumber(hourly.precipitation, i),
    });
  }
  return samples;
}

function readNumber(values: (number | null)[] | undefined, index: number): number | null {
  if (!values || index >= values.length) {
    return null;
  }
  const value = values[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchArchiveWeather(deps: {
  fetch: FetchLike;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
}): Promise<WeatherHourlySample[]> {
  const url = buildArchiveUrl(deps.latitude, deps.longitude, deps.startDate, deps.endDate);
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo archive request failed (HTTP ${response.status})`);
  }
  const json = (await response.json()) as OpenMeteoArchiveResponse;
  return parseHourlySamples(json);
}

export function cacheKeyForBucket(bucket: string, startDate: string, endDate: string): string {
  return `cp.weather.v1:${bucket}:${startDate}:${endDate}`;
}

export function bucketFromPoint(latitude: number, longitude: number): string {
  return locationBucketKey(latitude, longitude);
}
