/**
 * @complex-patient/mobile — Unlock route
 *
 * Renders the shared UnlockScreen. Uses an in-memory KDF storage for Expo Go
 * compatibility (no native expo-secure-store dependency).
 *
 * Requirements: 7.2, 7.3, 7.6, 7.8, 7.9
 */

import React from 'react';
import { UnlockScreen } from '@complex-patient/ui';

/**
 * In-memory KDF material storage for Expo Go. In production (dev client),
 * this would be backed by expo-secure-store via nativeFlagStorage.
 */
const inMemoryKdfStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
})();

export default function Unlock(): React.ReactElement {
  return (
    <UnlockScreen
      kdfStorage={inMemoryKdfStorage}
      biometricAvailable={false}
    />
  );
}
