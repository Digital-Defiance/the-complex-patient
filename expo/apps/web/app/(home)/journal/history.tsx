/**
 * @complex-patient/web — Symptom journal history route
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { SymptomJournalHistoryScreen } from '@complex-patient/ui/screens';

export default function JournalHistory(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleLogSymptom = useCallback(() => {
    router.push('/(home)/journal/log' as never);
  }, [router]);

  return (
    <SymptomJournalHistoryScreen onBack={handleBack} onLogSymptom={handleLogSymptom} />
  );
}
