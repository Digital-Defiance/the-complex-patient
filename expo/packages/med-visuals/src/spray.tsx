/**
 * Parametric nasal spray bottle — tall silhouette (nozzle, flange, rounded body).
 * `size` is the total icon height; width stays narrower than height.
 */

import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { shadeHex } from './color';

export interface SprayIconProps {
  colorPrimary?: string;
  colorAccent?: string;
  size?: number;
  testID?: string;
}

export function SprayIcon({
  colorPrimary = '#eef1f4',
  colorAccent = '#b8c0cc',
  size = 36,
  testID,
}: SprayIconProps): React.ReactElement {
  const canvasWidth = Math.round(size * 0.46);
  const bodyWidth = Math.round(size * 0.34);
  const bodyHeight = Math.round(size * 0.54);
  const neckWidth = Math.round(bodyWidth * 0.58);
  const neckHeight = Math.max(2, Math.round(size * 0.045));
  const flangeWidth = Math.round(size * 0.42);
  const flangeHeight = Math.max(3, Math.round(size * 0.075));
  const stemWidth = Math.max(2, Math.round(size * 0.07));
  const stemHeight = Math.max(2, Math.round(size * 0.035));
  const nozzleHeight = Math.round(size * 0.15);
  const nozzleHalf = Math.max(2, Math.round(size * 0.045));
  const baseWidth = Math.round(bodyWidth * 1.06);
  const baseHeight = Math.max(2, Math.round(size * 0.05));

  const bodyColor = colorPrimary;
  const metalColor = shadeHex(bodyColor, -0.07);
  const labelColor = shadeHex(colorAccent, 0.42);

  return (
    <View
      style={[styles.wrap, { width: canvasWidth, height: size }]}
      testID={testID}
    >
      <View style={styles.stack}>
        <View
          style={[
            styles.nozzle,
            {
              borderBottomWidth: nozzleHeight,
              borderLeftWidth: nozzleHalf,
              borderRightWidth: nozzleHalf,
              borderBottomColor: metalColor,
            },
          ]}
        />

        <View
          style={[
            styles.stem,
            {
              width: stemWidth,
              height: stemHeight,
              backgroundColor: metalColor,
            },
          ]}
        />

        <View
          style={[
            styles.flange,
            iconShadow,
            {
              width: flangeWidth,
              height: flangeHeight,
              borderRadius: flangeHeight / 2,
              backgroundColor: metalColor,
            },
          ]}
        />

        <View
          style={[
            styles.neck,
            {
              width: neckWidth,
              height: neckHeight,
              backgroundColor: shadeHex(bodyColor, -0.04),
            },
          ]}
        />

        <View
          style={[
            styles.body,
            iconShadow,
            {
              width: bodyWidth,
              height: bodyHeight,
              borderRadius: Math.round(size * 0.07),
              backgroundColor: bodyColor,
              borderColor: shadeHex(bodyColor, -0.14),
            },
          ]}
        >
          <View
            style={[
              styles.labelRecess,
              {
                width: Math.round(bodyWidth * 0.3),
                height: Math.round(bodyHeight * 0.42),
                borderRadius: Math.round(bodyWidth * 0.18),
                backgroundColor: labelColor,
                borderColor: shadeHex(labelColor, -0.1),
              },
            ]}
          />
          <View
            style={[
              styles.bodySheen,
              {
                right: Math.round(bodyWidth * 0.11),
                width: Math.max(2, Math.round(bodyWidth * 0.1)),
                height: Math.round(bodyHeight * 0.5),
                borderRadius: Math.max(1, Math.round(bodyWidth * 0.05)),
              },
            ]}
          />
        </View>

        <View
          style={[
            styles.base,
            {
              width: baseWidth,
              height: baseHeight,
              borderRadius: baseHeight,
              backgroundColor: shadeHex(bodyColor, -0.18),
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
  shadowOpacity: 0.1,
  shadowRadius: 1,
  elevation: 1,
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
  },
  nozzle: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopWidth: 0,
    marginBottom: -1,
  },
  stem: {
    borderRadius: 1,
    marginBottom: -1,
  },
  flange: {
    marginBottom: -1,
  },
  neck: {
    borderRadius: 1,
    marginBottom: -1,
  },
  body: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  labelRecess: {
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.8,
  },
  bodySheen: {
    position: 'absolute',
    top: '20%',
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  base: {
    marginTop: 1,
    opacity: 0.45,
  },
});
