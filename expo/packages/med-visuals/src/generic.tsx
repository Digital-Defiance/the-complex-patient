import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface GenericMedIconProps {
  size?: number;
  testID?: string;
}

/** Neutral placeholder when dose unit has no meaningful product shape (unit, custom other). */
export function GenericMedIcon({ size = 36, testID }: GenericMedIconProps): React.ReactElement {
  const wellSize = Math.round(size * 1.55);
  const fontSize = Math.round(size * 0.42);

  return (
    <View
      style={[
        styles.well,
        {
          width: wellSize,
          height: wellSize,
          borderRadius: wellSize / 2,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.glyph, { fontSize, lineHeight: fontSize * 1.05 }]} accessibilityLabel="Medication">
        Rx
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  well: {
    backgroundColor: '#e8eaed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    color: '#64748b',
    fontWeight: '600',
  },
});
