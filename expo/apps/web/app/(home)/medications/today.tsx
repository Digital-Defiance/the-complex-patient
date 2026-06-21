import React from 'react';
import { useRouter } from 'expo-router';
import { MedicationsTodayScreen } from '@complex-patient/ui';

export default function MedicationsTodayRoute(): React.ReactElement {
  const router = useRouter();
  return (
    <MedicationsTodayScreen
      onBack={() => router.back()}
      onPrn={() => router.push('/(home)/medications/prn' as never)}
    />
  );
}
