/**
 * @complex-patient/mobile — Root index redirect
 *
 * Expo Router loads this as the initial route. It reads the current `route`
 * from the AppHost context (derived via `resolveRoute` on every controller
 * notification) and redirects to the corresponding screen path.
 *
 * This file is intentionally thin: the navigation state machine lives in the
 * pure `resolveRoute` function; this component simply maps route names to Expo
 * Router pathnames.
 */

import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAppHost } from '@complex-patient/ui';
import { View, ActivityIndicator } from 'react-native';

/**
 * Map from AppRoute name to the Expo Router pathname for the mobile app.
 */
function routeToPathname(routeName: string): string | null {
  switch (routeName) {
    case 'loading':
      return null; // stay on this screen, show spinner
    case 'age-gate':
      return '/onboarding/age-gate';
    case 'ineligible':
      return '/onboarding/ineligible';
    case 'secure-context-required':
      return '/secure-context-required';
    case 'composition-failed':
      return '/composition-failed';
    case 'sign-in':
      return '/auth/sign-in';
    case 'unlock':
      return '/auth/unlock';
    case 'home':
      return '/(home)';
    default:
      return null;
  }
}

export default function Index(): React.ReactElement {
  const { route, onboarding, enterHome } = useAppHost();
  const router = useRouter();

  // When onboarding becomes eligible, trigger home construction.
  useEffect(() => {
    if (onboarding.getStatus() === 'eligible') {
      void enterHome();
    }
  }, [route, onboarding, enterHome]);

  // Navigate to the resolved route.
  useEffect(() => {
    const pathname = routeToPathname(route.name);
    if (pathname) {
      router.replace(pathname as never);
    }
  }, [route, router]);

  // While loading, show a spinner.
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
