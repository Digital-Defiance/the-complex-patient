import { describe, it, expect } from 'vitest';
import {
  createWeatherPreferencesPort,
  ATTACH_LOCATION_PREF_KEY,
  RECORD_LOCATION_TRAIL_PREF_KEY,
} from './weather-preferences';

describe('createWeatherPreferencesPort', () => {
  it('defaults attach-location and trail to off', async () => {
    const storage = new Map<string, string>();
    const preferences = createWeatherPreferencesPort({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    });

    expect(await preferences.isAttachLocationEnabled()).toBe(false);
    expect(await preferences.isRecordLocationTrailEnabled()).toBe(false);

    await preferences.setAttachLocationEnabled(true);
    expect(storage.get(ATTACH_LOCATION_PREF_KEY)).toBe('true');
    expect(await preferences.isAttachLocationEnabled()).toBe(true);

    await preferences.setRecordLocationTrailEnabled(true);
    expect(storage.get(RECORD_LOCATION_TRAIL_PREF_KEY)).toBe('true');
    expect(await preferences.isRecordLocationTrailEnabled()).toBe(true);
  });
});
