/**
 * Inline RxNorm identity label for medication rows (informational only).
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { MedicationProfile } from '@complex-patient/domain';
import { UNIDENTIFIED_MEDICATION_NOTE } from '@complex-patient/drug-naming';
import { resolveMedicationRxLabelForUi } from '../../medications-ui';

export interface MedicationRxLabelProps {
  medication: Pick<MedicationProfile, 'drugName' | 'rxDisplayName' | 'userConfirmedRxMatch'>;
  testID?: string;
}

export function MedicationRxLabel({
  medication,
  testID = 'medication-rx-label',
}: MedicationRxLabelProps): React.ReactElement | null {
  const label = resolveMedicationRxLabelForUi(medication);
  if (!label) {
    return null;
  }

  if (label.kind === 'stored-as') {
    return (
      <Text style={styles.confirmed} testID={testID}>
        Stored as: {label.generic}
      </Text>
    );
  }

  if (label.kind === 'matched') {
    return (
      <Text style={styles.confirmed} testID={testID}>
        Matched in naming database
      </Text>
    );
  }

  return (
    <Text style={styles.unidentified} testID={testID}>
      {UNIDENTIFIED_MEDICATION_NOTE}
    </Text>
  );
}

const styles = StyleSheet.create({
  confirmed: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  unidentified: {
    fontSize: 11,
    lineHeight: 16,
    color: '#94a3b8',
    marginTop: 2,
  },
});
