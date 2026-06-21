/**
 * Opt-in GPS capture for journal and medication logs.
 */

import type { LogLocation } from '@complex-patient/domain';
import { captureLogLocation } from '@complex-patient/weather';
import type { WeatherHostDeps } from '../weather-host-context';

export async function captureJournalLocation(
  weather: WeatherHostDeps,
  capturedAt: string,
): Promise<LogLocation | undefined> {
  return captureLogLocation({
    preferences: weather.preferences,
    location: weather.location,
    capturedAt,
  });
}
