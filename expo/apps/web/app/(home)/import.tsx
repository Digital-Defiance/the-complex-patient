/**
 * @complex-patient/web — Import export preview route
 */

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ImportScreen } from '@complex-patient/ui';

export default function ImportRoute(): React.ReactElement {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleClearFile = useCallback(() => {
    setFileBytes(null);
    setFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRequestFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setFileBytes(null);
      setFileName(null);
      return;
    }

    const buffer = await file.arrayBuffer();
    setFileBytes(new Uint8Array(buffer));
    setFileName(file.name);
  }, []);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <ImportScreen
        onBack={handleBack}
        fileBytes={fileBytes}
        fileName={fileName}
        onClearFile={handleClearFile}
        onRequestFile={handleRequestFile}
        fileSelectionAvailable
      />
    </>
  );
}
