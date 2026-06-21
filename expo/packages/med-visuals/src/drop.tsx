import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { shadeHex } from './color';

export interface DropIconProps {
  colorPrimary?: string;
  colorAccent?: string;
  size?: number;
  testID?: string;
}

/** Eye / ear drop bottle with a single teardrop accent. */
export function DropIcon({
  colorPrimary = '#e0f2fe',
  colorAccent = '#0284c7',
  size = 36,
  testID,
}: DropIconProps): React.ReactElement {
  const bodyWidth = Math.round(size * 0.38);
  const bodyHeight = Math.round(size * 0.52);
  const capHeight = Math.max(4, Math.round(size * 0.12));
  const tipHeight = Math.max(3, Math.round(size * 0.08));
  const dropSize = Math.round(size * 0.14);

  return (
    <View style={[styles.wrap, { width: bodyWidth + dropSize, height: size }]} testID={testID}>
      <View style={{ alignItems: 'center' }}>
        <View
          style={[
            styles.tip,
            {
              borderBottomWidth: tipHeight,
              borderLeftWidth: Math.round(bodyWidth * 0.12),
              borderRightWidth: Math.round(bodyWidth * 0.12),
              borderBottomColor: shadeHex(colorPrimary, -0.12),
            },
          ]}
        />
        <View
          style={[
            styles.cap,
            iconShadow,
            {
              width: bodyWidth * 0.72,
              height: capHeight,
              borderRadius: 2,
              backgroundColor: shadeHex(colorPrimary, -0.18),
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
              borderRadius: Math.round(size * 0.06),
              backgroundColor: colorPrimary,
              borderColor: shadeHex(colorPrimary, -0.16),
            },
          ]}
        >
          <View
            style={[
              styles.liquid,
              {
                bottom: Math.round(bodyHeight * 0.12),
                height: Math.round(bodyHeight * 0.42),
                backgroundColor: shadeHex(colorAccent, 0.15),
              },
            ]}
          />
        </View>
      </View>
      <View
        style={[
          styles.drop,
          {
            right: 0,
            bottom: Math.round(size * 0.18),
            width: dropSize,
            height: Math.round(dropSize * 1.25),
            borderRadius: dropSize,
            backgroundColor: colorAccent,
          },
        ]}
      />
    </View>
  );
}

const iconShadow: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.12,
  shadowRadius: 1,
  elevation: 1,
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tip: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopWidth: 0,
    marginBottom: -1,
  },
  cap: {
    marginBottom: -1,
  },
  body: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  liquid: {
    position: 'absolute',
    left: '12%',
    right: '12%',
    borderRadius: 4,
  },
  drop: {
    position: 'absolute',
    opacity: 0.92,
  },
});
