/**
 * @complex-patient/web — Physician Report screen route
 *
 * Expo Router route file that renders the shared PhysicianReportScreen component.
 * Generates the physician report on-device through the Insights_Engine report
 * path without transmitting report-source PHI to the Sync_Backend. On failure,
 * shows a report-generation-failure message and stays on insights (navigates back).
 *
 * Requirements: 11.4, 11.5, 11.6
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { PhysicianReportScreen } from '@complex-patient/ui/screens';

export default function Report(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return <PhysicianReportScreen onBack={handleBack} />;
}
