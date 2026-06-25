import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { MedicationsScreen } from '@complex-patient/ui/screens';

export default function MedicationsCabinetRoute(): React.ReactElement {
  const router = useRouter();

  const handleEdit = useCallback(
    (medicationId: string) => {
      router.push(`/(home)/medications/edit?id=${medicationId}` as never);
    },
    [router],
  );

  return (
    <MedicationsScreen
      onBack={() => router.back()}
      onNavigatePrn={() => router.push('/(home)/medications/prn' as never)}
      onAdd={() => router.push('/(home)/medications/add' as never)}
      onEditMedication={handleEdit}
    />
  );
}
