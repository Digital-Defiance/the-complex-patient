/**
 * @complex-patient/mobile — Symptom journal log route
 *
 * Expo Router route file that renders the shared SymptomJournalLogScreen
 * component. Routes symptom entries through `createSymptomJournal` (no other
 * path) and persists exclusively through `home.commit`.
 *
 * Requirements: 10.1, 10.5, 10.6, 10.7, 10.8
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { SymptomJournalLogScreen } from '@complex-patient/ui';

export default function JournalLog(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return <SymptomJournalLogScreen onBack={handleBack} />;
}
