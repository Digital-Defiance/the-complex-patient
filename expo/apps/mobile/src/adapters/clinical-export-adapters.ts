/**
 * Mobile adapters for clinical export pick/save/share.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { base64ToUint8Array, uint8ArrayToBase64 } from './clinical-export-bytes';

export async function pickClinicalExportZip(): Promise<{ bytes: Uint8Array; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return {
    bytes: base64ToUint8Array(base64),
    name: asset.name ?? 'export.zip',
  };
}

export async function saveAndShareClinicalExport(bytes: Uint8Array, filename: string): Promise<void> {
  if (!FileSystem.cacheDirectory) {
    throw new Error('File cache is unavailable on this device.');
  }

  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, uint8ArrayToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/zip',
    dialogTitle: 'Share clinical export',
    UTI: 'com.pkware.zip-archive',
  });
}
