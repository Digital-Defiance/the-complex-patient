/**
 * Platform-injected ports for optional location capture and weather preferences.
 * No Expo or browser globals — implementations live in apps/mobile and apps/web.
 */

import type { RoundedCoordinates } from './geo';

export type LocationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** Captures approximate device location when the user opts in. */
export interface LocationCapturePort {
  readonly platformLabel: string;
  getPermissionStatus(): Promise<LocationPermissionStatus>;
  requestPermission(): Promise<LocationPermissionStatus>;
  captureRounded(): Promise<RoundedCoordinates | null>;
}

/** Device-local preference (not synced); default off. */
export interface WeatherPreferencesPort {
  isAttachLocationEnabled(): Promise<boolean>;
  setAttachLocationEnabled(enabled: boolean): Promise<void>;
  isRecordLocationTrailEnabled(): Promise<boolean>;
  setRecordLocationTrailEnabled(enabled: boolean): Promise<void>;
}

export interface FetchLike {
  (url: string, init?: { method?: string }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

/** Minimal key-value store for the derived weather cache (not synced). */
export interface WeatherCacheStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

export interface LocationTimePoint {
  latitude: number;
  longitude: number;
  isoTimestamp: string;
}

/** Hourly weather sample normalized from Open-Meteo. */
export interface WeatherHourlySample {
  time: string;
  surfacePressureHpa: number | null;
  relativeHumidityPct: number | null;
  temperatureC: number | null;
  precipitationMm: number | null;
}

/** Daily aggregates for chart overlays. */
export interface WeatherTrendDay {
  day: string;
  meanPressureHpa: number | null;
  meanHumidityPct: number | null;
  meanTemperatureC: number | null;
  totalPrecipitationMm: number | null;
  pressureDelta24h: number | null;
  meanHeatIndexC: number | null;
  rapidPressureDrop: boolean;
}

export interface WeatherService {
  loadTrendForPoints(
    days: readonly string[],
    points: readonly LocationTimePoint[],
  ): Promise<WeatherTrendDay[]>;
}
