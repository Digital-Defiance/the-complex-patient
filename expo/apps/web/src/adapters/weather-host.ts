import { createWeatherService } from '@complex-patient/weather';
import type { WeatherHostDeps } from '@complex-patient/ui';
import { createWeatherCacheStore } from '../../../weather-cache-storage';
import { createWeatherPreferencesPort } from '../../../weather-preferences';
import { webFlagStorage } from '../adapters';
import { createBrowserLocationCapture } from './location';

export const webWeatherHost: WeatherHostDeps = {
  location: createBrowserLocationCapture(),
  preferences: createWeatherPreferencesPort(webFlagStorage),
  weather: createWeatherService({ cache: createWeatherCacheStore() }),
};
