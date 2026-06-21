/**
 * Mobile background location trail sampler (opt-in).
 *
 * While the vault is unlocked and the trail preference is on, periodically captures
 * rounded GPS fixes into the `locationTrail` partition.
 */

import React, { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import type { LocationTrailSample, VaultRecord } from '@complex-patient/domain';
import {
  buildLocationTrailSample,
  pruneTrailSamples,
  shouldAppendTrailSample,
} from '@complex-patient/weather';
import { useAppHost } from '@complex-patient/ui';
import { mobileWeatherHost } from './adapters/weather-host';

const SAMPLE_INTERVAL_MS = 30 * 60 * 1000;

function removeLocationWatch(subscription: { remove?: () => void } | undefined): void {
  if (!subscription?.remove) {
    return;
  }
  try {
    subscription.remove();
  } catch {
    // expo-location web shims may not implement removeSubscription.
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `trail-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function LocationTrailSampler(): React.ReactElement | null {
  const { home } = useAppHost();
  const samplingRef = useRef(false);

  useEffect(() => {
    // Trail sampling is native-only; expo-location watch cleanup breaks on web.
    if (Platform.OS === 'web' || !home || home.getStatus() !== 'ready') {
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let watchSubscription: { remove?: () => void } | undefined;

    async function sampleOnce(): Promise<void> {
      if (!home || samplingRef.current || cancelled) {
        return;
      }

      samplingRef.current = true;
      try {
        const trailEnabled = await mobileWeatherHost.preferences.isRecordLocationTrailEnabled();
        if (!trailEnabled) {
          return;
        }

        const coords = await mobileWeatherHost.location.captureRounded();
        if (!coords) {
          return;
        }

        const capturedAt = new Date().toISOString();
        const existing = home.read<LocationTrailSample>('locationTrail').records;
        if (!shouldAppendTrailSample(existing, capturedAt)) {
          return;
        }

        const sample = buildLocationTrailSample({
          id: generateId(),
          opTimestamp: capturedAt,
          latitude: coords.latitude,
          longitude: coords.longitude,
          capturedAt,
        });

        await home.commit<VaultRecord>('locationTrail', (current) =>
          pruneTrailSamples([...(current as LocationTrailSample[]), sample]),
        );
      } finally {
        samplingRef.current = false;
      }
    }

    async function startWatch(): Promise<void> {
      try {
        const trailEnabled = await mobileWeatherHost.preferences.isRecordLocationTrailEnabled();
        if (!trailEnabled || cancelled) {
          return;
        }

        const Location = await import('expo-location');
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted' || cancelled) {
          return;
        }

        watchSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 500,
            timeInterval: SAMPLE_INTERVAL_MS,
          },
          () => {
            void sampleOnce();
          },
        );
      } catch {
        // Location unavailable — interval fallback still runs.
      }
    }

    void sampleOnce();
    intervalId = setInterval(() => {
      void sampleOnce();
    }, SAMPLE_INTERVAL_MS);
    void startWatch();

    const onAppStateChange = (state: AppStateStatus): void => {
      if (state === 'active') {
        void sampleOnce();
      }
    };
    const appStateSubscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
      removeLocationWatch(watchSubscription);
      appStateSubscription.remove();
    };
  }, [home]);

  return null;
}
