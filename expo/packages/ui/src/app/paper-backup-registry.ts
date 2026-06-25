/**
 * Device-local registry of paper-backup mnemonics, encrypted with the vault KEK.
 *
 * Mnemonics never leave the device. This cache exists solely so passphrase changes
 * can re-wrap server envelopes without asking the user to re-enter every sheet.
 */

import type { CryptoKeyRef, EncryptedPayload } from '@complex-patient/crypto-engine';
import { decrypt, encrypt } from '@complex-patient/crypto-engine';

export const PAPER_BACKUP_REGISTRY_STORAGE_KEY = 'complex-patient.paper-backup-registry';

export interface PaperBackupRegistryEntry {
  backupId: string;
  mnemonic: string;
  label?: string;
}

interface PaperBackupRegistryV1 {
  version: 1;
  entries: PaperBackupRegistryEntry[];
}

export interface PaperBackupRegistryStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem?(key: string): Promise<void> | void;
}

function emptyRegistry(): PaperBackupRegistryV1 {
  return { version: 1, entries: [] };
}

async function loadRegistry(
  storage: PaperBackupRegistryStorage,
  kek: CryptoKeyRef,
): Promise<PaperBackupRegistryV1> {
  const raw = await storage.getItem(PAPER_BACKUP_REGISTRY_STORAGE_KEY);
  if (!raw) {
    return emptyRegistry();
  }

  let blob: EncryptedPayload;
  try {
    blob = JSON.parse(raw) as EncryptedPayload;
  } catch {
    return emptyRegistry();
  }

  const decrypted = await decrypt(blob, kek);
  if (!decrypted.ok) {
    return emptyRegistry();
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(decrypted.plaintext)) as PaperBackupRegistryV1;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return emptyRegistry();
    }
    return parsed;
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(
  storage: PaperBackupRegistryStorage,
  kek: CryptoKeyRef,
  registry: PaperBackupRegistryV1,
): Promise<void> {
  const plaintext = new TextEncoder().encode(JSON.stringify(registry));
  const encrypted = await encrypt(plaintext, kek);
  await storage.setItem(PAPER_BACKUP_REGISTRY_STORAGE_KEY, JSON.stringify(encrypted));
}

export async function registerPaperBackupMnemonic(
  storage: PaperBackupRegistryStorage,
  kek: CryptoKeyRef,
  entry: PaperBackupRegistryEntry,
): Promise<void> {
  const registry = await loadRegistry(storage, kek);
  const without = registry.entries.filter((item) => item.backupId !== entry.backupId);
  without.push(entry);
  await saveRegistry(storage, kek, { version: 1, entries: without });
}

export async function unregisterPaperBackupMnemonic(
  storage: PaperBackupRegistryStorage,
  kek: CryptoKeyRef,
  backupId: string,
): Promise<void> {
  const registry = await loadRegistry(storage, kek);
  const entries = registry.entries.filter((item) => item.backupId !== backupId);
  if (entries.length === registry.entries.length) {
    return;
  }
  await saveRegistry(storage, kek, { version: 1, entries });
}

export async function listRegisteredPaperBackups(
  storage: PaperBackupRegistryStorage,
  kek: CryptoKeyRef,
): Promise<PaperBackupRegistryEntry[]> {
  const registry = await loadRegistry(storage, kek);
  return registry.entries;
}

/** Re-encrypt the registry under a new KEK after passphrase change. */
export async function rekeyPaperBackupRegistry(
  storage: PaperBackupRegistryStorage,
  oldKek: CryptoKeyRef,
  newKek: CryptoKeyRef,
): Promise<void> {
  const registry = await loadRegistry(storage, oldKek);
  if (registry.entries.length === 0) {
    return;
  }
  await saveRegistry(storage, newKek, registry);
}
