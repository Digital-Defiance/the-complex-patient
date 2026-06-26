/**
 * Settings copy for on-device drug naming data.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  DRUG_NAMING_ASSIST_ENABLED,
  getDatasetAttribution,
  getDatasetVersion,
  MEDICATION_NAMING_ATTRIBUTION,
  MEDICATION_NAMING_DISCLAIMER,
} from '@complex-patient/drug-naming';

export function DrugNamingAboutSection({
  testID = 'drug-naming-about',
}: {
  testID?: string;
}): React.ReactElement | null {
  if (!DRUG_NAMING_ASSIST_ENABLED) {
    return null;
  }

  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.title}>Drug naming assistance</Text>
      <Text style={styles.body}>{MEDICATION_NAMING_DISCLAIMER}</Text>
      <Text style={styles.meta}>Dataset version: {getDatasetVersion()}</Text>
      <Text style={styles.meta}>{getDatasetAttribution()}</Text>
      <Text style={styles.meta}>{MEDICATION_NAMING_ATTRIBUTION}</Text>
      <Text style={styles.body}>
        Checks run entirely on your device. Your medication list is not sent to our servers for
        naming or grouping.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#fafafa',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  meta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
});
