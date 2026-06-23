/**
 * Decrypt encrypted vault partition blobs into record sets.
 *
 * Shared by conflict resolution (HTTP 409) and merge-aware remote pull.
 */

import type { VaultRecord, PartitionPayload } from '@complex-patient/domain';
import type {
  CryptoKeyRef,
  EncryptedPayload,
  DecryptResult,
} from '@complex-patient/crypto-engine';

/** Minimal crypto surface for partition blob decrypt. */
export interface VaultBlobCrypto {
  decrypt(blob: EncryptedPayload, kek: CryptoKeyRef): Promise<DecryptResult>;
}

/** Map a stored vault blob envelope to {@link EncryptedPayload}. */
export function toEncryptedPayload(blob: {
  iv: string;
  auth_tag: string;
  ciphertext: string;
}): EncryptedPayload {
  return { iv: blob.iv, authTag: blob.auth_tag, ciphertext: blob.ciphertext };
}

/**
 * Decrypt + verify an encrypted envelope and parse its partition records.
 * Returns `null` when verification fails or the plaintext is not a valid
 * {@link PartitionPayload}.
 */
export async function decryptPartitionRecords(
  envelope: EncryptedPayload,
  crypto: VaultBlobCrypto,
  kek: CryptoKeyRef,
): Promise<VaultRecord[] | null> {
  const result = await crypto.decrypt(envelope, kek);
  if (!result.ok) {
    return null;
  }
  try {
    const text = new TextDecoder().decode(result.plaintext);
    const parsed = JSON.parse(text) as PartitionPayload<VaultRecord>;
    if (parsed == null || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
      return null;
    }
    return parsed.records;
  } catch {
    return null;
  }
}
