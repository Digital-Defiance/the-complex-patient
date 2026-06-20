/**
 * @complex-patient/web — Symptom journal hub route
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { SymptomJournalHubScreen } from '@complex-patient/ui';

export default function JournalHub(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <SymptomJournalHubScreen
      onBack={handleBack}
      onNavigateLog={() => router.push('/(home)/journal/log' as never)}
      onNavigateHistory={() => router.push('/(home)/journal/history' as never)}
      onNavigateFlare={() => router.push('/(home)/journal/flare' as never)}
    />
  );
}
