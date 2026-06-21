/**
 * Weather service — cache + Open-Meteo archive fetches.
 */

import type {
  FetchLike,
  LocationTimePoint,
  WeatherCacheStore,
  WeatherService,
  WeatherTrendDay,
} from './ports';
import { createWeatherCache, groupPointsIntoRequests } from './cache';
import { buildWeatherTrendDaysForLocations } from './overlay';
import { fetchArchiveWeather } from './open-meteo';

export interface CreateWeatherServiceDeps {
  cache: WeatherCacheStore;
  fetch?: FetchLike;
}

function resolveFetch(provided?: FetchLike): FetchLike {
  if (provided) {
    return provided;
  }
  const g = globalThis as { fetch?: FetchLike };
  if (typeof g.fetch === 'function') {
    return g.fetch.bind(globalThis) as FetchLike;
  }
  throw new Error('no fetch implementation available for weather service');
}

export function createWeatherService(deps: CreateWeatherServiceDeps): WeatherService {
  const fetchImpl = resolveFetch(deps.fetch);
  const cache = createWeatherCache(deps.cache);

  return {
    async loadTrendForPoints(
      days: readonly string[],
      points: readonly LocationTimePoint[],
    ): Promise<WeatherTrendDay[]> {
      if (days.length === 0 || points.length === 0) {
        return days.map((day) => ({
          day,
          meanPressureHpa: null,
          meanHumidityPct: null,
          meanTemperatureC: null,
          totalPrecipitationMm: null,
          pressureDelta24h: null,
        }));
      }

      const requests = groupPointsIntoRequests(points, days);
      const samplesByBucket = new Map<string, Awaited<ReturnType<typeof fetchArchiveWeather>>>();

      for (const request of requests) {
        let samples = await cache.get(request.bucket, request.startDate, request.endDate);
        if (!samples) {
          samples = await fetchArchiveWeather({
            fetch: fetchImpl,
            latitude: request.latitude,
            longitude: request.longitude,
            startDate: request.startDate,
            endDate: request.endDate,
          });
          await cache.set(request.bucket, request.startDate, request.endDate, samples);
        }
        samplesByBucket.set(request.bucket, samples);
      }

      return buildWeatherTrendDaysForLocations(days, points, samplesByBucket);
    },
  };
}
