/**
 * Prompt user to confirm a suggested RxNorm match before notices run.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RxMatchCandidate } from '@complex-patient/drug-naming';
import { RX_MATCH_CONFIRM_PROMPT, UNIDENTIFIED_MEDICATION_NOTE } from '@complex-patient/drug-naming';
import { resolveRxMatchConfirmView } from '../../medications-ui';

export interface RxMatchConfirmPanelProps {
  typedName: string;
  candidate: RxMatchCandidate | null;
  confirmed: boolean | null;
  onConfirm: () => void;
  onDecline: () => void;
  onUnsure: () => void;
  testID?: string;
}

export function RxMatchConfirmPanel({
  typedName,
  candidate,
  confirmed,
  onConfirm,
  onDecline,
  onUnsure,
  testID = 'rx-match-confirm',
}: RxMatchConfirmPanelProps): React.ReactElement | null {
  const view = resolveRxMatchConfirmView(Boolean(candidate), confirmed);

  if (view === 'hidden') {
    return null;
  }

  if (view === 'unidentified') {
    return (
      <View style={styles.unidentified} testID={`${testID}-unidentified`}>
        <Text style={styles.unidentifiedText}>{UNIDENTIFIED_MEDICATION_NOTE}</Text>
      </View>
    );
  }

  if (view === 'confirmed' && candidate) {
    return (
      <View style={styles.confirmed} testID={`${testID}-confirmed`}>
        <Text style={styles.confirmedText}>Stored as: {candidate.displayName}</Text>
      </View>
    );
  }

  if (view === 'declined') {
    return (
      <View style={styles.unidentified} testID={`${testID}-declined`}>
        <Text style={styles.unidentifiedText}>{UNIDENTIFIED_MEDICATION_NOTE}</Text>
      </View>
    );
  }

  if (!candidate) {
    return null;
  }

  return (
    <View style={styles.panel} testID={testID}>
      <Text style={styles.prompt}>{RX_MATCH_CONFIRM_PROMPT(candidate.displayName, typedName)}</Text>
      <View style={styles.actions}>
        <Pressable style={styles.primaryBtn} onPress={onConfirm} testID={`${testID}-yes`}>
          <Text style={styles.primaryText}>Yes</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={onDecline} testID={`${testID}-no`}>
          <Text style={styles.secondaryText}>No</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={onUnsure} testID={`${testID}-unsure`}>
          <Text style={styles.secondaryText}>Not sure</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  prompt: {
    fontSize: 13,
    lineHeight: 19,
    color: '#1e3a8a',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  secondaryText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 13,
  },
  confirmed: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    padding: 10,
  },
  confirmedText: {
    fontSize: 13,
    color: '#166534',
  },
  unidentified: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
  },
  unidentifiedText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
});
