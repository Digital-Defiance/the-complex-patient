/**
 * Derived weather cache — local only, refetchable from log coordinates.
 */

import type { WeatherCacheStore, WeatherHourlySample } from './ports';
import { bucketFromPoint, cacheKeyForBucket } from './open-meteo';

export interface WeatherCache {
  get(bucket: string, startDate: string, endDate: string): Promise<WeatherHourlySample[] | null>;
  set(
    bucket: string,
    startDate: string,
    endDate: string,
    samples: WeatherHourlySample[],
  ): Promise<void>;
}

export function createWeatherCache(store: WeatherCacheStore): WeatherCache {
  return {
    async get(bucket, startDate, endDate) {
      const raw = await store.getItem(cacheKeyForBucket(bucket, startDate, endDate));
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as WeatherHourlySample[];
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async set(bucket, startDate, endDate, samples) {
      await store.setItem(cacheKeyForBucket(bucket, startDate, endDate), JSON.stringify(samples));
    },
  };
}

export interface LocationBucketRequest {
  bucket: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
}

/** Collapse location/time points into batched Open-Meteo requests per geohash bucket. */
export function groupPointsIntoRequests(
  points: readonly { latitude: number; longitude: number; isoTimestamp: string }[],
  daySpan: readonly string[],
): LocationBucketRequest[] {
  if (points.length === 0 || daySpan.length === 0) {
    return [];
  }

  const startDate = daySpan[0] ?? '';
  const endDate = daySpan[daySpan.length - 1] ?? startDate;
  const byBucket = new Map<string, { latitude: number; longitude: number }>();

  for (const point of points) {
    const bucket = bucketFromPoint(point.latitude, point.longitude);
    if (!byBucket.has(bucket)) {
      byBucket.set(bucket, { latitude: point.latitude, longitude: point.longitude });
    }
  }

  return [...byBucket.entries()].map(([bucket, coords]) => ({
    bucket,
    latitude: coords.latitude,
    longitude: coords.longitude,
    startDate,
    endDate,
  }));
}
