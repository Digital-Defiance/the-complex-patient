/**
 * @complex-patient/web — Medications screen route
 *
 * Expo Router route file that renders the shared MedicationsScreen component.
 * Renders `buildPolypharmacyView` output in exact order, shows an empty-list
 * message for zero profiles, and persists edits exclusively through
 * `home.commit('medications', …)`.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.6, 9.7
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { MedicationsScreen } from '@complex-patient/ui';

export default function Medications(): React.ReactElement {
  const router = useRouter();

  const handleNavigatePrn = useCallback(() => {
    router.push('/(home)/medications/prn' as never);
  }, [router]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <MedicationsScreen
      onNavigatePrn={handleNavigatePrn}
      onBack={handleBack}
    />
  );
}
