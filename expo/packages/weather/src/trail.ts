/**
 * Location trail sample helpers: dedupe, retention, point conversion.
 */

import type { LocationTrailSample } from '@complex-patient/domain';
import type { LocationTimePoint } from './ports';
import { calendarDayKey } from './geo';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_TRAIL_RETAIN_DAYS = 30;
export const DEFAULT_TRAIL_MIN_INTERVAL_MS = 30 * 60 * 1000;

export function trailSampleToPoint(
  sample: Pick<LocationTrailSample, 'latitude' | 'longitude' | 'capturedAt'>,
): LocationTimePoint {
  return {
    latitude: sample.latitude,
    longitude: sample.longitude,
    isoTimestamp: sample.capturedAt,
  };
}

export function locationPointsFromTrailSamples(
  samples: readonly Pick<LocationTrailSample, 'latitude' | 'longitude' | 'capturedAt'>[],
): LocationTimePoint[] {
  return samples
    .map(trailSampleToPoint)
    .sort((left, right) => left.isoTimestamp.localeCompare(right.isoTimestamp));
}

/** Skip samples too close in time to the latest existing fix. */
export function shouldAppendTrailSample(
  existing: readonly Pick<LocationTrailSample, 'capturedAt'>[],
  candidateCapturedAt: string,
  minIntervalMs = DEFAULT_TRAIL_MIN_INTERVAL_MS,
): boolean {
  if (existing.length === 0) {
    return true;
  }

  const candidateMs = Date.parse(candidateCapturedAt);
  if (Number.isNaN(candidateMs)) {
    return false;
  }

  const latest = existing.reduce((current, sample) =>
    sample.capturedAt.localeCompare(current.capturedAt) > 0 ? sample : current,
  );
  const latestMs = Date.parse(latest.capturedAt);
  if (Number.isNaN(latestMs)) {
    return true;
  }

  return candidateMs - latestMs >= minIntervalMs;
}

export function pruneTrailSamples(
  samples: readonly LocationTrailSample[],
  retainDays = DEFAULT_TRAIL_RETAIN_DAYS,
  referenceDate: Date = new Date(),
): LocationTrailSample[] {
  const cutoffMs = referenceDate.getTime() - retainDays * MS_PER_DAY;
  return samples.filter((sample) => {
    const ms = Date.parse(sample.capturedAt);
    return !Number.isNaN(ms) && ms >= cutoffMs;
  });
}

export function buildLocationTrailSample(deps: {
  id: string;
  opTimestamp: string;
  latitude: number;
  longitude: number;
  capturedAt: string;
}): LocationTrailSample {
  return {
    id: deps.id,
    op_timestamp: deps.opTimestamp,
    latitude: deps.latitude,
    longitude: deps.longitude,
    capturedAt: deps.capturedAt,
  };
}

export function trailSamplesForDay(
  samples: readonly LocationTrailSample[],
  day: string,
): LocationTrailSample[] {
  return samples.filter((sample) => calendarDayKey(sample.capturedAt) === day);
}
