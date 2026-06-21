import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { shadeHex } from './color';

export interface PatchIconProps {
  colorPrimary?: string;
  colorAccent?: string;
  size?: number;
  testID?: string;
}

/** Transdermal patch — rounded square with a subtle peel corner. */
export function PatchIcon({
  colorPrimary = '#dbeafe',
  colorAccent = '#2563eb',
  size = 36,
  testID,
}: PatchIconProps): React.ReactElement {
  const width = Math.round(size * 0.88);
  const height = Math.round(size * 0.72);
  const radius = Math.round(size * 0.1);
  const peel = Math.round(size * 0.16);

  return (
    <View style={[styles.wrap, { width, height: height + peel * 0.35 }]} testID={testID}>
      <View
        style={[
          styles.patch,
          iconShadow,
          {
            width,
            height,
            borderRadius: radius,
            backgroundColor: colorPrimary,
            borderColor: shadeHex(colorPrimary, -0.18),
          },
        ]}
      >
        <View
          style={[
            styles.innerBand,
            {
              width: width * 0.72,
              height: height * 0.22,
              borderRadius: radius * 0.6,
              backgroundColor: shadeHex(colorAccent, 0.2),
              borderColor: shadeHex(colorAccent, -0.05),
            },
          ]}
        />
        <View
          style={[
            styles.peel,
            {
              top: -peel * 0.35,
              right: width * 0.08,
              width: peel,
              height: peel,
              borderRadius: peel * 0.25,
              backgroundColor: shadeHex(colorPrimary, 0.18),
              borderColor: shadeHex(colorPrimary, -0.1),
            },
          ]}
        />
      </View>
    </View>
  );
}

const iconShadow: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.14,
  shadowRadius: 1.5,
  elevation: 2,
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  patch: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'visible',
  },
  innerBand: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  peel: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '18deg' }],
  },
});
