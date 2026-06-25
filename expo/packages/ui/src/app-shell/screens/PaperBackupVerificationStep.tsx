/**
 * Spot-check wizard: confirm the user wrote recovery words before dismissing.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import {
  PAPER_BACKUP_VERIFICATION_PROMPT_COUNT,
  selectPaperBackupVerificationPrompts,
  verifyPaperBackupVerificationAnswers,
  type PaperBackupVerificationPrompt,
} from '@complex-patient/crypto-engine';

export interface PaperBackupVerificationStepProps {
  words: readonly string[];
  onVerified: () => void;
  onBack?: () => void;
}

export function PaperBackupVerificationStep({
  words,
  onVerified,
  onBack,
}: PaperBackupVerificationStepProps): React.ReactElement {
  const prompts = useMemo(
    () => selectPaperBackupVerificationPrompts(words, PAPER_BACKUP_VERIFICATION_PROMPT_COUNT),
    [words],
  );
  const [answers, setAnswers] = useState<string[]>(() =>
    Array.from({ length: prompts.length }, () => ''),
  );
  const [error, setError] = useState<string | null>(null);

  const updateAnswer = useCallback((index: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setError(null);
  }, []);

  const handleVerify = useCallback(() => {
    if (
      verifyPaperBackupVerificationAnswers(
        words,
        prompts as PaperBackupVerificationPrompt[],
        answers,
      )
    ) {
      onVerified();
      return;
    }
    setError('One or more words do not match your sheet. Check spelling and try again.');
  }, [answers, onVerified, prompts, words]);

  return (
    <View style={styles.container} testID="paper-backup-verification">
      <Text style={styles.title}>Confirm your backup</Text>
      <Text style={styles.hint}>
        Enter the recovery words at the positions below from the sheet you just wrote down.
      </Text>

      {prompts.map((prompt, index) => (
        <View key={prompt.position} style={styles.field}>
          <Text style={styles.label}>Word #{prompt.position}</Text>
          <TextInput
            style={styles.input}
            value={answers[index]}
            onChangeText={(value) => updateAnswer(index, value)}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="recovery word"
            testID={`paper-backup-verify-word-${prompt.position}`}
          />
        </View>
      ))}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={styles.primaryButton}
        onPress={handleVerify}
        accessibilityRole="button"
        testID="paper-backup-verify-submit"
      >
        <Text style={styles.primaryButtonText}>Confirm words</Text>
      </Pressable>

      {onBack ? (
        <Pressable style={styles.linkButton} onPress={onBack} accessibilityRole="button">
          <Text style={styles.linkText}>Back to sheet</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8a1f1f',
  },
  hint: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  error: {
    color: '#c62828',
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  linkButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  linkText: {
    color: '#0066cc',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
