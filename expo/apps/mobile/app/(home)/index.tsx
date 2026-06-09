/**
 * @complex-patient/mobile — Authenticated home screen route
 *
 * Expo Router route file that renders the shared HomeScreen component. This
 * screen is shown while the Home_Controller status is `ready`. It presents
 * navigation entries for Medications, Symptom Journal, and Insights, and
 * wires sign-out through `home.signOut()`.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { HomeScreen } from '@complex-patient/ui';

export default function Home(): React.ReactElement {
  const router = useRouter();

  const handleNavigate = useCallback(
    (subsystem: 'medications' | 'journal' | 'insights') => {
      console.log('[Home] navigating to:', subsystem);
      switch (subsystem) {
        case 'medications':
          router.push('/(home)/medications' as never);
          break;
        case 'journal':
          router.push('/(home)/journal/log' as never);
          break;
        case 'insights':
          router.push('/(home)/insights' as never);
          break;
      }
    },
    [router],
  );

  const handleSignedOut = useCallback(() => {
    router.replace('/auth/sign-in' as never);
  }, [router]);

  return (
    <HomeScreen
      onNavigate={handleNavigate}
      onSignedOut={handleSignedOut}
    />
  );
}
