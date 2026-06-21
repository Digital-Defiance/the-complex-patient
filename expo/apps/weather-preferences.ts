/**
 * Device-local weather/location preference (opt-in, not synced).
 */

import type { WeatherPreferencesPort } from '@complex-patient/weather';
import type { DeviceFlagStorage } from '@complex-patient/ui';

export const ATTACH_LOCATION_PREF_KEY = 'complex-patient.attach-location';
export const RECORD_LOCATION_TRAIL_PREF_KEY = 'complex-patient.record-location-trail';

export function createWeatherPreferencesPort(storage: DeviceFlagStorage): WeatherPreferencesPort {
  return {
    async isAttachLocationEnabled() {
      const value = await storage.getItem(ATTACH_LOCATION_PREF_KEY);
      return value === 'true';
    },
    async setAttachLocationEnabled(enabled) {
      await storage.setItem(ATTACH_LOCATION_PREF_KEY, enabled ? 'true' : 'false');
    },
    async isRecordLocationTrailEnabled() {
      const value = await storage.getItem(RECORD_LOCATION_TRAIL_PREF_KEY);
      return value === 'true';
    },
    async setRecordLocationTrailEnabled(enabled) {
      await storage.setItem(RECORD_LOCATION_TRAIL_PREF_KEY, enabled ? 'true' : 'false');
    },
  };
}
