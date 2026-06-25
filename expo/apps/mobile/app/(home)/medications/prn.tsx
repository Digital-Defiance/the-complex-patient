/**
 * @complex-patient/mobile — PRN Quick Log screen route
 *
 * Expo Router route file that renders the shared PrnQuickLogScreen component.
 * Routes entries exclusively through the PrnQuickLogEngine path (no other
 * regimen mutation); renders the PrnQuickLogEvaluation outcome including any
 * safety-threshold-exceeded result before accepting another entry; persists
 * through home.commit and retains values on commit failure.
 *
 * Requirements: 9.4, 9.5, 9.6, 9.7
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { PrnQuickLogScreen } from '@complex-patient/ui/screens';

export default function PrnQuickLog(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <PrnQuickLogScreen onBack={handleBack} />
  );
}
