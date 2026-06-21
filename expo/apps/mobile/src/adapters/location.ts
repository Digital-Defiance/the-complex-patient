/**
 * Native location capture via expo-location (when user opts in).
 */

import type { LocationCapturePort, LocationPermissionStatus } from '@complex-patient/weather';
import { roundCoordinates } from '@complex-patient/weather';

function mapPermission(status: string): LocationPermissionStatus {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    default:
      return 'prompt';
  }
}

export function createExpoLocationCapture(): LocationCapturePort {
  return {
    platformLabel: 'device GPS',
    async getPermissionStatus() {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.getForegroundPermissionsAsync();
        return mapPermission(status);
      } catch {
        return 'unsupported';
      }
    },
    async requestPermission() {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        return mapPermission(status);
      } catch {
        return 'unsupported';
      }
    },
    async captureRounded() {
      try {
        const Location = await import('expo-location');
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          return null;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        return roundCoordinates(position.coords.latitude, position.coords.longitude);
      } catch {
        return null;
      }
    },
  };
}
