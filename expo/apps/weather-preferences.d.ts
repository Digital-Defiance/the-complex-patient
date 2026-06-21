/**
 * Device-local weather/location preference (opt-in, not synced).
 */
import type { WeatherPreferencesPort } from '@complex-patient/weather';
import type { DeviceFlagStorage } from '@complex-patient/ui';
export declare const ATTACH_LOCATION_PREF_KEY = "complex-patient.attach-location";
export declare const RECORD_LOCATION_TRAIL_PREF_KEY = "complex-patient.record-location-trail";
export declare function createWeatherPreferencesPort(storage: DeviceFlagStorage): WeatherPreferencesPort;
