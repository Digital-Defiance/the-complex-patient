/**
 * Passive informational notices for duplicate ingredients and same-class overlap.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MedicationProfile } from '@complex-patient/domain';
import { resolveMedicationNamingNoticesForUi } from '../../medications-ui';

export interface MedicationNamingNoticesProps {
  medications: readonly MedicationProfile[];
  testID?: string;
}

export function MedicationNamingNotices({
  medications,
  testID = 'medication-naming-notices',
}: MedicationNamingNoticesProps): React.ReactElement | null {
  const notices = useMemo(
    () => resolveMedicationNamingNoticesForUi(medications),
    [medications],
  );

  if (notices.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.title}>Naming database notes</Text>
      {notices.map((notice) => (
        <View
          key={`${notice.kind}-${notice.medicationIds.join('-')}-${notice.classId ?? notice.ingredientRxcui ?? ''}`}
          style={styles.notice}
          testID={`${testID}-${notice.kind}`}
        >
          <Text style={styles.noticeText}>{notice.message}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  notice: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
});
