import { describe, expect, it } from 'vitest';
import { generatePaperBackupMnemonic, normalizePaperBackupMnemonic } from './paper-backup';
import {
  selectPaperBackupVerificationPrompts,
  verifyPaperBackupVerificationAnswers,
} from './paper-backup-verification';

describe('paper-backup-verification', () => {
  it('picks distinct 1-based positions', () => {
    const words = normalizePaperBackupMnemonic(generatePaperBackupMnemonic()).split(' ');
    let roll = 0;
    const prompts = selectPaperBackupVerificationPrompts(words, 3, () => {
      roll += 1;
      return (roll * 0.17) % 1;
    });
    expect(prompts).toHaveLength(3);
    const positions = prompts.map((item) => item.position);
    expect(new Set(positions).size).toBe(3);
    positions.forEach((position) => {
      expect(position).toBeGreaterThanOrEqual(1);
      expect(position).toBeLessThanOrEqual(24);
    });
  });

  it('validates matching answers', () => {
    const words = normalizePaperBackupMnemonic(generatePaperBackupMnemonic()).split(' ');
    const prompts = [
      { position: 1 },
      { position: 12 },
      { position: 24 },
    ];
    expect(
      verifyPaperBackupVerificationAnswers(words, prompts, [
        words[0]!,
        words[11]!,
        words[23]!,
      ]),
    ).toBe(true);
    expect(
      verifyPaperBackupVerificationAnswers(words, prompts, [
        words[0]!,
        'wrong',
        words[23]!,
      ]),
    ).toBe(false);
  });
});
