/**
 * @complex-patient/web — Condition timeline route
 *
 * Expo Router route file for the per-condition timeline screen. Renders the
 * shared ConditionTimelineScreen component with the conditionId extracted from
 * route search params.
 *
 * Requirements: 10.3, 10.4
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ConditionTimelineScreen } from '@complex-patient/ui';

export default function Timeline(): React.ReactElement {
  const { conditionId } = useLocalSearchParams<{ conditionId: string }>();

  return <ConditionTimelineScreen conditionId={conditionId ?? ''} />;
}
