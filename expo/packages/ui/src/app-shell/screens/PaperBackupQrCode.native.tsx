/**
 * Native QR renderer — PNG written to cache, then shown via file:// Image.
 *
 * Android release builds crash on `data:` URIs in Image and on react-native-svg QR
 * mounts. Print/share still use the PNG qrDataUrl from createPaperBackup.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

export interface PaperBackupQrCodeProps {
  backupId: string;
  mnemonic: string;
  qrDataUrl?: string;
  size?: number;
  testID?: string;
}

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

function pngBase64FromDataUrl(qrDataUrl: string | undefined): string | null {
  if (!qrDataUrl?.startsWith(PNG_DATA_URL_PREFIX)) {
    return null;
  }
  return qrDataUrl.slice(PNG_DATA_URL_PREFIX.length);
}

export function PaperBackupQrCode({
  backupId,
  qrDataUrl,
  size = 180,
  testID = 'paper-backup-qr',
}: PaperBackupQrCodeProps): React.ReactElement {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cacheFileUri: string | null = null;

    const prepare = async (): Promise<void> => {
      const base64 = pngBase64FromDataUrl(qrDataUrl);
      if (!base64) {
        if (!cancelled) {
          setFailed(true);
        }
        return;
      }

      try {
        const FileSystem = await import('expo-file-system/legacy');
        const cacheDir = FileSystem.cacheDirectory;
        if (!cacheDir) {
          throw new Error('cacheDirectory unavailable');
        }

        cacheFileUri = `${cacheDir}paper-backup-qr-${backupId}.png`;
        await FileSystem.writeAsStringAsync(cacheFileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (!cancelled) {
          setImageUri(cacheFileUri);
          setFailed(false);
          console.log('[PaperBackup] qr image ready');
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error('[PaperBackup] qr image failed:', message);
        if (!cancelled) {
          setFailed(true);
        }
      }
    };

    setImageUri(null);
    setFailed(false);
    void prepare();

    return () => {
      cancelled = true;
      if (cacheFileUri) {
        void import('expo-file-system/legacy').then((FileSystem) =>
          FileSystem.deleteAsync(cacheFileUri!, { idempotent: true }),
        );
      }
    };
  }, [backupId, qrDataUrl]);

  if (failed) {
    return (
      <View
        style={[styles.frame, styles.failed, { width: size, height: size }]}
        accessibilityLabel="Paper backup QR code unavailable"
        testID={`${testID}-failed`}
      >
        <ActivityIndicator />
      </View>
    );
  }

  if (!imageUri) {
    return <PaperBackupQrCodeLoading size={size} testID={`${testID}-loading`} />;
  }

  return (
    <View
      style={[styles.frame, { width: size, height: size }]}
      accessibilityLabel="Paper backup QR code"
      testID={testID}
    >
      <Image
        source={{ uri: imageUri }}
        style={{ width: size - 2, height: size - 2 }}
        resizeMode="contain"
      />
    </View>
  );
}

/** @internal exported for tests that assert loading UI exists */
export function PaperBackupQrCodeLoading({
  size = 180,
  testID = 'paper-backup-qr-loading',
}: {
  size?: number;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={[styles.frame, styles.loading, { width: size, height: size }]} testID={testID}>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  failed: {
    backgroundColor: '#fafafa',
  },
});
