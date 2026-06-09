/**
 * @complex-patient/crypto-engine
 *
 * Isomorphic cryptographic module: KDF, AES-256-GCM, runtime provider detection.
 * All cryptographic operations execute strictly on the client.
 */

export type {
  CryptoProvider,
  RuntimeContext,
  ProviderDecision,
  CryptoKeyRef,
  KdfParams,
  EncryptedPayload,
  DeriveResult,
  DecryptResult,
  CryptoEngine,
} from './types';

export { wrapKey } from './types';
export { selectProvider, detectRuntimeContext } from './provider';
export { generateSalt, deriveKEK } from './kdf';
export { encrypt, decrypt } from './cipher';
