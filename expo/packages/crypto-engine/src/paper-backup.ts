/**
 * @complex-patient/crypto-engine — Paper backup keys
 *
 * Zero-knowledge account recovery: each paper backup is a 24-word BIP-39 mnemonic
 * that wraps the vault KEK + KDF material. The server stores only the encrypted
 * envelope — no system master key, no admin recovery path.
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { decrypt, encrypt } from './cipher';
import type { CryptoKeyRef, EncryptedPayload, KdfParams } from './types';
import { wrapKey } from './types';

/** Expected word count for a 256-bit entropy BIP-39 mnemonic. */
export const PAPER_BACKUP_WORD_COUNT = 24;

/** Current envelope schema version. */
export const PAPER_BACKUP_ENVELOPE_VERSION = 1 as const;

const HKDF_INFO = 'complex-patient-paper-backup-v1';
const BACKUP_KEY_BYTES = 32;

/** Payload encrypted inside each paper-backup envelope. */
export interface PaperBackupEnvelopeV1 {
  version: typeof PAPER_BACKUP_ENVELOPE_VERSION;
  kek_b64: string;
  salt_b64: string;
  params: KdfParams;
  created_at: string;
}

/** Recovered vault key material from a paper backup. */
export interface PaperBackupRecoveryMaterial {
  kek: CryptoKeyRef;
  salt: Uint8Array;
  params: KdfParams;
  createdAt: string;
}

/** Printable template metadata (mnemonic shown once at creation). */
export interface PaperBackupTemplate {
  words: string[];
  backupId: string;
  label?: string;
  createdAt: Date;
  instructions: string;
  warnings: readonly string[];
}

const PAPER_BACKUP_WARNINGS: readonly string[] = [
  'Anyone with this paper key can unlock your health vault',
  'Do not store digitally or photograph',
  'Create multiple keys and revoke any that are lost or compromised',
] as const;

const PAPER_BACKUP_INSTRUCTIONS =
  'Store this paper key in a secure location. You will need it to recover your vault if you forget your master passphrase.';

function hasSubtleCrypto(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.importKey === 'function' &&
    typeof globalThis.crypto.subtle.deriveBits === 'function'
  );
}

function keyBytes(kek: CryptoKeyRef): Uint8Array {
  const inner = kek._inner;
  if (!(inner instanceof Uint8Array) || inner.length !== BACKUP_KEY_BYTES) {
    throw new Error('invalid KEK material');
  }
  return inner;
}

export function normalizePaperBackupMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(value, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveBackupKeyBytes(seed: Uint8Array): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const baseKey = await globalThis.crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveBits']);
    const bits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: utf8Bytes(HKDF_INFO),
      },
      baseKey,
      BACKUP_KEY_BYTES * 8,
    );
    return new Uint8Array(bits);
  }

  return hkdf(sha256, seed, new Uint8Array(), utf8ToBytes(HKDF_INFO), BACKUP_KEY_BYTES);
}

/** Generate a new 24-word BIP-39 paper backup mnemonic. */
export function generatePaperBackupMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

/** Validate mnemonic structure and BIP-39 checksum. */
export function validatePaperBackupMnemonic(mnemonic: string): boolean {
  const normalized = normalizePaperBackupMnemonic(mnemonic);
  const words = normalized.split(' ');
  if (words.length !== PAPER_BACKUP_WORD_COUNT) {
    return false;
  }
  return validateMnemonic(normalized, wordlist);
}

/** Derive the AES-256 backup wrapping key from a mnemonic. */
export async function derivePaperBackupKey(mnemonic: string): Promise<CryptoKeyRef> {
  const normalized = normalizePaperBackupMnemonic(mnemonic);
  if (!validatePaperBackupMnemonic(normalized)) {
    throw new Error('invalid paper backup mnemonic');
  }
  const seed = mnemonicToSeedSync(normalized);
  const backupKeyBytes = await deriveBackupKeyBytes(seed);
  return wrapKey(backupKeyBytes);
}

export interface PaperBackupKdfMaterial {
  salt: Uint8Array;
  params: KdfParams;
}

/**
 * Create a paper backup: generate mnemonic, wrap KEK + KDF material, return both.
 * The mnemonic is shown once to the user and never sent to the server.
 */
export async function createPaperBackupWrap(
  kek: CryptoKeyRef,
  material: PaperBackupKdfMaterial,
): Promise<{ mnemonic: string; wrapped: EncryptedPayload; template: PaperBackupTemplate; backupId: string }> {
  const mnemonic = generatePaperBackupMnemonic();
  const wrapped = await wrapKekForPaperBackup(mnemonic, kek, material);
  const backupId = createPaperBackupId();
  const template = buildPaperBackupTemplate(mnemonic, backupId);
  return { mnemonic, wrapped, template, backupId };
}

/** Wrap the current KEK and KDF material with a specific mnemonic. */
export async function wrapKekForPaperBackup(
  mnemonic: string,
  kek: CryptoKeyRef,
  material: PaperBackupKdfMaterial,
): Promise<EncryptedPayload> {
  const envelope: PaperBackupEnvelopeV1 = {
    version: PAPER_BACKUP_ENVELOPE_VERSION,
    kek_b64: toBase64(keyBytes(kek)),
    salt_b64: toBase64(material.salt),
    params: material.params,
    created_at: new Date().toISOString(),
  };

  const plaintext = utf8Bytes(JSON.stringify(envelope));
  const backupKey = await derivePaperBackupKey(mnemonic);
  return encrypt(plaintext, backupKey);
}

/** Unwrap KEK + KDF material from a server-stored envelope using the mnemonic. */
export async function unwrapKekFromPaperBackup(
  mnemonic: string,
  wrapped: EncryptedPayload,
): Promise<PaperBackupRecoveryMaterial> {
  const backupKey = await derivePaperBackupKey(mnemonic);
  const decrypted = await decrypt(wrapped, backupKey);
  if (!decrypted.ok) {
    throw new Error('paper backup decryption failed');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytesToUtf8(decrypted.plaintext));
  } catch {
    throw new Error('malformed paper backup envelope');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as PaperBackupEnvelopeV1).version !== PAPER_BACKUP_ENVELOPE_VERSION
  ) {
    throw new Error('unsupported paper backup envelope version');
  }

  const envelope = parsed as PaperBackupEnvelopeV1;
  if (
    typeof envelope.kek_b64 !== 'string' ||
    typeof envelope.salt_b64 !== 'string' ||
    typeof envelope.params !== 'object' ||
    envelope.params === null ||
    typeof envelope.created_at !== 'string'
  ) {
    throw new Error('malformed paper backup envelope');
  }

  const kekBytes = fromBase64(envelope.kek_b64);
  const salt = fromBase64(envelope.salt_b64);
  if (kekBytes.length !== BACKUP_KEY_BYTES || salt.length < 16) {
    throw new Error('invalid paper backup key material');
  }

  return {
    kek: wrapKey(kekBytes),
    salt,
    params: envelope.params,
    createdAt: envelope.created_at,
  };
}

/** Build printable template text for a paper backup. */
export function buildPaperBackupTemplate(
  mnemonic: string,
  backupId: string,
  label?: string,
): PaperBackupTemplate {
  return {
    words: normalizePaperBackupMnemonic(mnemonic).split(' '),
    backupId,
    label,
    createdAt: new Date(),
    instructions: PAPER_BACKUP_INSTRUCTIONS,
    warnings: PAPER_BACKUP_WARNINGS,
  };
}

/** Format a paper backup template as plain text suitable for printing or sharing. */
export function formatPaperBackupTemplateText(template: PaperBackupTemplate): string {
  const lines = [
    'THE COMPLEX PATIENT — PAPER BACKUP KEY',
    '',
    `Backup ID: ${template.backupId}`,
    ...(template.label ? [`Label: ${template.label}`] : []),
    `Created: ${template.createdAt.toISOString()}`,
    '',
    'Recovery words (write in order):',
    '',
  ];

  template.words.forEach((word, index) => {
    const number = String(index + 1).padStart(2, ' ');
    lines.push(`${number}. ${word}`);
  });

  lines.push('', 'Warnings:');
  for (const warning of template.warnings) {
    lines.push(`• ${warning}`);
  }
  lines.push('', template.instructions);
  return lines.join('\n');
}

/** Create a random backup identifier (UUID v4). */
export function createPaperBackupId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
