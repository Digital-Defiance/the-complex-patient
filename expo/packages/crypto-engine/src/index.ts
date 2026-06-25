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
export {
  PAPER_BACKUP_WORD_COUNT,
  PAPER_BACKUP_ENVELOPE_VERSION,
  generatePaperBackupMnemonic,
  validatePaperBackupMnemonic,
  normalizePaperBackupMnemonic,
  derivePaperBackupKey,
  createPaperBackupWrap,
  wrapKekForPaperBackup,
  unwrapKekFromPaperBackup,
  buildPaperBackupTemplate,
  formatPaperBackupTemplateText,
  createPaperBackupId,
  type PaperBackupEnvelopeV1,
  type PaperBackupRecoveryMaterial,
  type PaperBackupTemplate,
  type PaperBackupKdfMaterial,
} from './paper-backup';
export {
  PAPER_BACKUP_QR_PREFIX,
  encodePaperBackupQrPayload,
  decodePaperBackupQrPayload,
  generatePaperBackupQrDataUrl,
  generatePaperBackupQrMatrix,
  renderQrSvgDataUrl,
  qrMatrixSide,
} from './paper-backup-qr';
export {
  PAPER_BACKUP_VERIFICATION_PROMPT_COUNT,
  selectPaperBackupVerificationPrompts,
  verifyPaperBackupVerificationAnswers,
  type PaperBackupVerificationPrompt,
} from './paper-backup-verification';
