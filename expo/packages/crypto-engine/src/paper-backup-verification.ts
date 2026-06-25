/**
 * Spot-check prompts so users confirm they wrote recovery words correctly.
 */

import { PAPER_BACKUP_WORD_COUNT } from './paper-backup';

export const PAPER_BACKUP_VERIFICATION_PROMPT_COUNT = 3;

/** One-based word position shown during verification (1–24). */
export interface PaperBackupVerificationPrompt {
  position: number;
}

function assertWordCount(words: readonly string[]): void {
  if (words.length !== PAPER_BACKUP_WORD_COUNT) {
    throw new Error(`expected ${PAPER_BACKUP_WORD_COUNT} recovery words`);
  }
}

/**
 * Pick distinct random word positions for a verification wizard.
 * Positions are 1-based to match the numbered sheet.
 */
export function selectPaperBackupVerificationPrompts(
  words: readonly string[],
  count = PAPER_BACKUP_VERIFICATION_PROMPT_COUNT,
  random: () => number = Math.random,
): PaperBackupVerificationPrompt[] {
  assertWordCount(words);
  if (count < 1 || count > PAPER_BACKUP_WORD_COUNT) {
    throw new Error('invalid verification prompt count');
  }

  const positions = new Set<number>();
  while (positions.size < count) {
    positions.add(Math.floor(random() * PAPER_BACKUP_WORD_COUNT) + 1);
  }

  return [...positions]
    .sort((a, b) => a - b)
    .map((position) => ({ position }));
}

function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Returns true when every prompted word matches the mnemonic. */
export function verifyPaperBackupVerificationAnswers(
  words: readonly string[],
  prompts: readonly PaperBackupVerificationPrompt[],
  answers: readonly string[],
): boolean {
  assertWordCount(words);
  if (prompts.length !== answers.length) {
    return false;
  }

  return prompts.every((prompt, index) => {
    const expected = words[prompt.position - 1];
    if (!expected) {
      return false;
    }
    return normalizeAnswer(expected) === normalizeAnswer(answers[index] ?? '');
  });
}
