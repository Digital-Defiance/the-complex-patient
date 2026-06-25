/**
 * @complex-patient/web — Clinical export screen route
 */

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ExportScreen } from '@complex-patient/ui/screens';

export default function ExportRoute(): React.ReactElement {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSaveExport = useCallback(async (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  return <ExportScreen onBack={handleBack} onSaveExport={handleSaveExport} />;
}
