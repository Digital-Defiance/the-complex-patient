/**
 * KDF material persistence outside the encrypted vault (non-secret salt + params).
 */

import type { KdfParams } from '@complex-patient/crypto-engine';
import { bytesFromBase64, base64FromBytes, normalizeKdfParams } from '../../app/kdf-material-sync';

/** Storage key for persisted KDF material (non-secret). */
export const KDF_MATERIAL_STORAGE_KEY = 'complex-patient.kdf-material';

/**
 * Interface for persisting KDF material (salt + params) outside the vault.
 * Both native (expo-secure-store / AsyncStorage) and web (localStorage) satisfy
 * this shape. The stored data is NOT secret — it contains only the salt and the
 * algorithm parameters needed to re-derive the same KEK on subsequent unlocks.
 */
export interface KdfMaterialStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

/** Persisted KDF material structure (non-secret). */
export interface StoredKdfMaterial {
  saltBase64: string;
  params: KdfParams;
}

/**
 * Create load/save functions for KDF material backed by a key-value storage.
 * The storage is outside the vault (non-secret location), suitable for
 * expo-secure-store or localStorage.
 */
export function createKdfMaterialStorage(storage: KdfMaterialStorage) {
  return {
    async loadKdfMaterial(): Promise<{ salt: Uint8Array; params: KdfParams } | null> {
      const raw = await storage.getItem(KDF_MATERIAL_STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed: StoredKdfMaterial = JSON.parse(raw);
        const salt = bytesFromBase64(parsed.saltBase64);
        return { salt, params: normalizeKdfParams(parsed.params) };
      } catch {
        return null;
      }
    },
    async saveKdfMaterial(m: { salt: Uint8Array; params: KdfParams }): Promise<void> {
      const stored: StoredKdfMaterial = {
        saltBase64: base64FromBytes(m.salt),
        params: m.params,
      };
      await storage.setItem(KDF_MATERIAL_STORAGE_KEY, JSON.stringify(stored));
    },
  };
}
