export type {
  FetchLike,
  LocationCapturePort,
  LocationPermissionStatus,
  LocationTimePoint,
  WeatherCacheStore,
  WeatherHourlySample,
  WeatherPreferencesPort,
  WeatherService,
  WeatherTrendDay,
} from './ports';

export type { RoundedCoordinates } from './geo';
export {
  calendarDayKey,
  locationBucketKey,
  roundCoordinate,
  roundCoordinates,
} from './geo';

export {
  buildArchiveUrl,
  fetchArchiveWeather,
  parseHourlySamples,
  OPEN_METEO_ARCHIVE_URL,
} from './open-meteo';

export { createWeatherCache, groupPointsIntoRequests } from './cache';
export type { LocationBucketRequest, WeatherCache } from './cache';

export {
  buildWeatherTrendDays,
  buildWeatherTrendDaysForLocations,
} from './overlay';

export {
  captureLogLocation,
  locationPointsForWeather,
  locationPointsFromJournalEvents,
  locationPointsFromPrnLogs,
  locationByDay,
  resolveDayLocationBucket,
} from './capture';

export {
  buildLocationTrailSample,
  DEFAULT_TRAIL_MIN_INTERVAL_MS,
  DEFAULT_TRAIL_RETAIN_DAYS,
  locationPointsFromTrailSamples,
  pruneTrailSamples,
  shouldAppendTrailSample,
  trailSampleToPoint,
} from './trail';

export { heatIndexC, isRapidPressureDrop } from './metrics';

export { createWeatherService } from './service';
export type { CreateWeatherServiceDeps } from './service';

export const WEATHER_PRIVACY_NOTICE =
  'When enabled, approximate location is captured when you log symptoms, flares, or PRN medications, ' +
  'and optionally as a background trail on mobile. Coordinates are rounded (~11 km), stored in your ' +
  'encrypted vault, and used with Open-Meteo for weather overlays — never your symptom text.';
