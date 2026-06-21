import React from 'react';
import { useRouter } from 'expo-router';
import { MedicationsHubScreen } from '@complex-patient/ui';

export default function MedicationsHubRoute(): React.ReactElement {
  const router = useRouter();

  return (
    <MedicationsHubScreen
      onBack={() => router.back()}
      onToday={() => router.push('/(home)/medications/today' as never)}
      onCabinet={() => router.push('/(home)/medications/cabinet' as never)}
      onHistory={() => router.push('/(home)/medications/history' as never)}
      onPrn={() => router.push('/(home)/medications/prn' as never)}
      onAdd={() => router.push('/(home)/medications/add' as never)}
    />
  );
}
