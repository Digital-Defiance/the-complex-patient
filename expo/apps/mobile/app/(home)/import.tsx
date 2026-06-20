/**
 * @complex-patient/mobile — Import export route
 */

import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { ImportScreen } from '@complex-patient/ui';
import { pickClinicalExportZip } from '../../src/adapters/clinical-export-adapters';

export default function ImportRoute(): React.ReactElement {
  const router = useRouter();
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleClearFile = useCallback(() => {
    setFileBytes(null);
    setFileName(null);
  }, []);

  const handleRequestFile = useCallback(async () => {
    const picked = await pickClinicalExportZip();
    if (!picked) {
      return;
    }

    setFileBytes(picked.bytes);
    setFileName(picked.name);
  }, []);

  return (
    <ImportScreen
      onBack={handleBack}
      fileBytes={fileBytes}
      fileName={fileName}
      onClearFile={handleClearFile}
      onRequestFile={handleRequestFile}
      fileSelectionAvailable
    />
  );
}
