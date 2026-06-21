/**
 * Browser geolocation adapter — prompts via navigator.geolocation when opted in.
 */

import type { LocationCapturePort, LocationPermissionStatus } from '@complex-patient/weather';
import { roundCoordinates } from '@complex-patient/weather';

function readNavigator(): Geolocation | null {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return null;
  }
  return navigator.geolocation;
}

export function createBrowserLocationCapture(): LocationCapturePort {
  return {
    platformLabel: 'browser location',
    async getPermissionStatus() {
      const geolocation = readNavigator();
      if (!geolocation) {
        return 'unsupported';
      }

      if (typeof navigator.permissions?.query !== 'function') {
        return 'prompt';
      }

      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        return mapPermissionState(result.state);
      } catch {
        return 'prompt';
      }
    },
    async requestPermission() {
      const coords = await capturePosition();
      return coords ? 'granted' : readNavigator() ? 'denied' : 'unsupported';
    },
    async captureRounded() {
      return capturePosition();
    },
  };
}

function mapPermissionState(state: PermissionState): LocationPermissionStatus {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    default:
      return 'prompt';
  }
}

async function capturePosition(): Promise<{ latitude: number; longitude: number } | null> {
  const geolocation = readNavigator();
  if (!geolocation) {
    return null;
  }

  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        resolve(roundCoordinates(position.coords.latitude, position.coords.longitude));
      },
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  });
}
