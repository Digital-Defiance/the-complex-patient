import React from 'react';
import { useRouter } from 'expo-router';
import { MedicationAdherenceHistoryScreen } from '@complex-patient/ui/screens';

export default function MedicationHistoryRoute(): React.ReactElement {
  const router = useRouter();
  return <MedicationAdherenceHistoryScreen onBack={() => router.back()} />;
}
