import { createWeatherService } from '@complex-patient/weather';
import type { WeatherHostDeps } from '@complex-patient/ui';
import { createWeatherCacheStore } from '../../../weather-cache-storage';
import { createWeatherPreferencesPort } from '../../../weather-preferences';
import { nativeFlagStorage } from '../adapters';
import { createExpoLocationCapture } from './location';

export const mobileWeatherHost: WeatherHostDeps = {
  location: createExpoLocationCapture(),
  preferences: createWeatherPreferencesPort(nativeFlagStorage),
  weather: createWeatherService({ cache: createWeatherCacheStore() }),
};
