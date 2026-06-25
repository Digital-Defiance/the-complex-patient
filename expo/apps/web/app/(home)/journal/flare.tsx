/**
 * @complex-patient/web — Flare-up log route
 *
 * Expo Router route file that renders the shared FlareScreen component.
 * Routes flare-ups through `createFlareJournal` (no other path) and persists
 * exclusively through `home.commit`.
 *
 * Requirements: 10.2, 10.5, 10.6, 10.7, 10.8
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { FlareScreen } from '@complex-patient/ui/screens';

export default function JournalFlare(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return <FlareScreen onBack={handleBack} />;
}
