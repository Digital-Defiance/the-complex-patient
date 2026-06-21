/** Rounded WGS84 coordinates (~11 km at 1 decimal). */
export interface RoundedCoordinates {
  latitude: number;
  longitude: number;
}

export function roundCoordinate(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundCoordinates(
  latitude: number,
  longitude: number,
  decimals = 1,
): RoundedCoordinates {
  return {
    latitude: roundCoordinate(latitude, decimals),
    longitude: roundCoordinate(longitude, decimals),
  };
}

export function locationBucketKey(latitude: number, longitude: number): string {
  const rounded = roundCoordinates(latitude, longitude);
  return `${rounded.latitude},${rounded.longitude}`;
}

export function calendarDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}
