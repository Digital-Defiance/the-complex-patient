import React from 'react';
import { useRouter } from 'expo-router';
import { MedicationFormScreen } from '@complex-patient/ui';

export default function MedicationAddRoute(): React.ReactElement {
  const router = useRouter();
  return (
    <MedicationFormScreen
      onSaved={() => router.replace('/(home)/medications/cabinet' as never)}
      onCancel={() => router.back()}
    />
  );
}
