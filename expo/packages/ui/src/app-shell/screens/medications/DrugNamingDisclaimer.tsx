/**
 * Medication naming disclaimer — informational only, not clinical advice.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MEDICATION_NAMING_DISCLAIMER } from '@complex-patient/drug-naming';

export function DrugNamingDisclaimer({ testID = 'drug-naming-disclaimer' }: { testID?: string }): React.ReactElement {
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.text}>{MEDICATION_NAMING_DISCLAIMER}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fbff',
    borderRadius: 10,
    padding: 12,
  },
  text: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
});
