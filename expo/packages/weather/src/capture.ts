/**
 * Attach optional rounded location to a med log when preferences allow.
 */

import type { FlareUp, LocationTrailSample, LogLocation, SymptomEntry } from '@complex-patient/domain';
import type { LocationCapturePort, LocationTimePoint, WeatherPreferencesPort } from './ports';
import { calendarDayKey } from './geo';
import { bucketFromPoint } from './open-meteo';
import { locationPointsFromTrailSamples } from './trail';

export async function captureLogLocation(deps: {
  preferences: WeatherPreferencesPort;
  location: LocationCapturePort;
  capturedAt: string;
}): Promise<LogLocation | undefined> {
  const enabled = await deps.preferences.isAttachLocationEnabled();
  if (!enabled) {
    return undefined;
  }

  const coords = await deps.location.captureRounded();
  if (!coords) {
    return undefined;
  }

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    capturedAt: deps.capturedAt,
  };
}

export function locationPointsFromPrnLogs(
  logs: readonly { takenAt: string; location?: LogLocation }[],
): LocationTimePoint[] {
  return logs
    .filter((log) => log.location !== undefined)
    .map((log) => ({
      latitude: log.location!.latitude,
      longitude: log.location!.longitude,
      isoTimestamp: log.takenAt,
    }));
}

function pointsFromTimestampedLogs(
  records: readonly { op_timestamp: string; location?: LogLocation }[],
): LocationTimePoint[] {
  return records
    .filter((record) => record.location !== undefined)
    .map((record) => ({
      latitude: record.location!.latitude,
      longitude: record.location!.longitude,
      isoTimestamp: record.op_timestamp,
    }));
}

/** All opt-in location captures from journal + PRN logs, for weather correlation. */
export function locationPointsFromJournalEvents(deps: {
  symptoms: readonly Pick<SymptomEntry, 'op_timestamp' | 'location'>[];
  flares: readonly Pick<FlareUp, 'op_timestamp' | 'location'>[];
  prnLogs: readonly { takenAt: string; location?: LogLocation }[];
}): LocationTimePoint[] {
  return [
    ...pointsFromTimestampedLogs(deps.symptoms),
    ...pointsFromTimestampedLogs(deps.flares),
    ...locationPointsFromPrnLogs(deps.prnLogs),
  ].sort((left, right) => left.isoTimestamp.localeCompare(right.isoTimestamp));
}

/** Merge log-time captures with background trail samples (latest per day wins in bucket resolver). */
export function locationPointsForWeather(deps: {
  symptoms: readonly Pick<SymptomEntry, 'op_timestamp' | 'location'>[];
  flares: readonly Pick<FlareUp, 'op_timestamp' | 'location'>[];
  prnLogs: readonly { takenAt: string; location?: LogLocation }[];
  trailSamples?: readonly Pick<LocationTrailSample, 'latitude' | 'longitude' | 'capturedAt'>[];
}): LocationTimePoint[] {
  const eventPoints = locationPointsFromJournalEvents(deps);
  const trailPoints = locationPointsFromTrailSamples(deps.trailSamples ?? []);
  return [...eventPoints, ...trailPoints].sort((left, right) =>
    left.isoTimestamp.localeCompare(right.isoTimestamp),
  );
}

/** Pick the geohash bucket for a day from the latest logged location that day. */
export function resolveDayLocationBucket(
  day: string,
  points: readonly LocationTimePoint[],
): string | null {
  const dayPoints = points.filter((point) => calendarDayKey(point.isoTimestamp) === day);
  if (dayPoints.length === 0) {
    return null;
  }
  const latest = dayPoints.reduce((current, candidate) =>
    candidate.isoTimestamp.localeCompare(current.isoTimestamp) > 0 ? candidate : current,
  );
  return bucketFromPoint(latest.latitude, latest.longitude);
}

/** Pick the latest logged location per calendar day (for display hints). */
export function locationByDay(
  points: readonly LocationTimePoint[],
): Map<string, { latitude: number; longitude: number }> {
  const latestByDay = new Map<string, LocationTimePoint>();
  for (const point of points) {
    const day = calendarDayKey(point.isoTimestamp);
    const existing = latestByDay.get(day);
    if (!existing || point.isoTimestamp.localeCompare(existing.isoTimestamp) > 0) {
      latestByDay.set(day, point);
    }
  }
  const map = new Map<string, { latitude: number; longitude: number }>();
  for (const [day, point] of latestByDay) {
    map.set(day, { latitude: point.latitude, longitude: point.longitude });
  }
  return map;
}
