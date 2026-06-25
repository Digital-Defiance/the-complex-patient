import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MedicationFormScreen } from '@complex-patient/ui/screens';

export default function MedicationEditRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  return (
    <MedicationFormScreen
      medicationId={typeof params.id === 'string' ? params.id : undefined}
      onSaved={() => router.replace('/(home)/medications/cabinet' as never)}
      onCancel={() => router.back()}
    />
  );
}
