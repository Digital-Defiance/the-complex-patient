/**
 * @complex-patient/mobile — Insights screen route
 *
 * Expo Router route file that renders the shared InsightsScreen component.
 * Renders correlation insight cards from the Insights_Engine; on insufficient
 * history shows the insufficient-history message with no cards; on zero
 * correlations without insufficiency shows a no-correlations-found message.
 * Computes cards only from `home.read` data; blocks insights with a
 * data-unavailable message when the data source is unavailable.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.6, 11.7
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { InsightsScreen } from '@complex-patient/ui';

export default function Insights(): React.ReactElement {
  const router = useRouter();

  const handleNavigateToReport = useCallback(() => {
    router.push('/(home)/insights/report' as never);
  }, [router]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <InsightsScreen
      onNavigateToReport={handleNavigateToReport}
      onBack={handleBack}
    />
  );
}
