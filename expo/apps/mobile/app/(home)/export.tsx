/**
 * @complex-patient/mobile — Clinical export screen route
 */

import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ExportScreen } from '@complex-patient/ui';
import { saveAndShareClinicalExport } from '../../src/adapters/clinical-export-adapters';

export default function ExportRoute(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSaveExport = useCallback(async (bytes: Uint8Array, filename: string) => {
    if (Platform.OS === 'web') {
      const blob = new Blob([bytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }

    await saveAndShareClinicalExport(bytes, filename);
  }, []);

  return <ExportScreen onBack={handleBack} onSaveExport={handleSaveExport} />;
}
