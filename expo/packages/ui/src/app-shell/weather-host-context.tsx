/**
 * Injects platform weather/location adapters into the authenticated stack.
 */

import React, { createContext, useContext } from 'react';
import type { LocationCapturePort, WeatherPreferencesPort, WeatherService } from '@complex-patient/weather';

export interface WeatherHostDeps {
  location: LocationCapturePort;
  preferences: WeatherPreferencesPort;
  weather: WeatherService;
}

const WeatherHostContext = createContext<WeatherHostDeps | null>(null);

export function useWeatherHost(): WeatherHostDeps {
  const value = useContext(WeatherHostContext);
  if (!value) {
    throw new Error('useWeatherHost must be used within WeatherHostProvider');
  }
  return value;
}

export interface WeatherHostProviderProps {
  deps: WeatherHostDeps;
  children: React.ReactNode;
}

export function WeatherHostProvider({ deps, children }: WeatherHostProviderProps): React.ReactElement {
  return <WeatherHostContext.Provider value={deps}>{children}</WeatherHostContext.Provider>;
}
