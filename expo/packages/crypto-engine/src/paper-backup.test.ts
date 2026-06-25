import { describe, expect, it } from 'vitest';
import { deriveKEK, generateSalt } from './kdf';
import {
  createPaperBackupWrap,
  formatPaperBackupTemplateText,
  normalizePaperBackupMnemonic,
  unwrapKekFromPaperBackup,
  validatePaperBackupMnemonic,
  wrapKekForPaperBackup,
} from './paper-backup';

describe('paper-backup', () => {
  it('generates and validates a 24-word mnemonic', async () => {
    const salt = await generateSalt();
    const derived = await deriveKEK('test-passphrase-12', salt, {
      algorithm: 'PBKDF2',
      pbkdf2Iterations: 600_000,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const { mnemonic, wrapped, template } = await createPaperBackupWrap(derived.kek, {
      salt,
      params: { algorithm: 'PBKDF2', pbkdf2Iterations: 600_000 },
    });

    expect(validatePaperBackupMnemonic(mnemonic)).toBe(true);
    expect(template.words).toHaveLength(24);
    expect(formatPaperBackupTemplateText(template)).toContain('Backup ID:');

    const recovered = await unwrapKekFromPaperBackup(mnemonic, wrapped);
    expect(recovered.salt).toEqual(salt);
    expect((recovered.kek._inner as Uint8Array)).toEqual(derived.kek._inner as Uint8Array);
  });

  it('rejects wrong mnemonic for wrapped payload', async () => {
    const salt = await generateSalt();
    const derived = await deriveKEK('test-passphrase-12', salt, {
      algorithm: 'PBKDF2',
      pbkdf2Iterations: 600_000,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const { mnemonic, wrapped } = await createPaperBackupWrap(derived.kek, {
      salt,
      params: { algorithm: 'PBKDF2', pbkdf2Iterations: 600_000 },
    });

    const words = mnemonic.split(' ');
    words[words.length - 1] = words[words.length - 1] === 'about' ? 'above' : 'about';
    const wrongMnemonic = words.join(' ');

    await expect(unwrapKekFromPaperBackup(wrongMnemonic, wrapped)).rejects.toThrow();
  });

  it('normalizes mnemonic whitespace and casing', () => {
    const sample = '  Word1   WORD2  ';
    expect(normalizePaperBackupMnemonic(sample)).toBe('word1 word2');
  });
});
