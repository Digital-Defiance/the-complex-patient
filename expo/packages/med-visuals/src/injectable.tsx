/**
 * Parametric vial and ampoule icons for injectables — no external assets.
 */

import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';

export type InjectableVariant = 'vial' | 'ampoule';

export interface InjectableIconProps {
  variant?: InjectableVariant;
  colorPrimary?: string;
  colorAccent?: string;
  size?: number;
  testID?: string;
}

export function InjectableIcon({
  variant = 'vial',
  colorPrimary = '#94a3b8',
  colorAccent = '#2563eb',
  size = 36,
  testID,
}: InjectableIconProps): React.ReactElement {
  if (variant === 'ampoule') {
    return <AmpouleShape colorPrimary={colorPrimary} colorAccent={colorAccent} size={size} testID={testID} />;
  }
  return <VialShape colorPrimary={colorPrimary} colorAccent={colorAccent} size={size} testID={testID} />;
}

function VialShape({
  colorPrimary,
  colorAccent,
  size,
  testID,
}: {
  colorPrimary: string;
  colorAccent: string;
  size: number;
  testID?: string;
}): React.ReactElement {
  const bodyWidth = Math.round(size * 0.44);
  const bodyHeight = Math.round(size * 0.56);
  const capWidth = Math.round(bodyWidth * 0.92);
  const capHeight = Math.max(6, Math.round(size * 0.17));
  const neckHeight = Math.max(3, Math.round(size * 0.05));
  const neckWidth = Math.round(bodyWidth * 0.72);
  const liquidHeight = Math.round(bodyHeight * 0.68);
  const capColor = shadeHex(colorPrimary, -0.35);

  return (
    <View style={[styles.wrap, { width: bodyWidth, height: size }]} testID={testID}>
      <View
        style={[
          styles.vialCap,
          iconShadow,
          {
            width: capWidth,
            height: capHeight,
            borderRadius: Math.max(2, Math.round(size * 0.04)),
            backgroundColor: capColor,
          },
        ]}
      >
        {[0.28, 0.46, 0.64, 0.82].map((topRatio) => (
          <View
            key={topRatio}
            style={[
              styles.capRib,
              {
                top: capHeight * topRatio,
                width: capWidth * 0.82,
                backgroundColor: shadeHex(capColor, 0.12),
              },
            ]}
          />
        ))}
        <View
          style={[
            styles.capHighlight,
            {
              width: capWidth * 0.22,
              height: capHeight * 0.35,
              borderRadius: capHeight,
            },
          ]}
        />
      </View>

      <View
        style={[
          styles.vialShoulder,
          {
            width: neckWidth,
            height: neckHeight,
            borderBottomLeftRadius: 1,
            borderBottomRightRadius: 1,
            backgroundColor: glassTint(colorPrimary),
          },
        ]}
      />

      <View
        style={[
          styles.glassBody,
          iconShadow,
          {
            width: bodyWidth,
            height: bodyHeight,
            borderBottomLeftRadius: Math.round(size * 0.05),
            borderBottomRightRadius: Math.round(size * 0.05),
            backgroundColor: glassTint(colorPrimary),
            borderColor: shadeHex(colorPrimary, -0.08),
          },
        ]}
      >
        <View
          style={[
            styles.liquidFill,
            {
              height: liquidHeight,
              backgroundColor: colorAccent,
            },
          ]}
        >
          <View
            style={[
              styles.liquidMeniscus,
              {
                width: bodyWidth * 0.78,
                height: Math.max(3, Math.round(size * 0.05)),
                borderRadius: Math.max(3, Math.round(size * 0.05)),
                backgroundColor: shadeHex(colorAccent, 0.08),
                marginTop: -2,
              },
            ]}
          />
        </View>
        <View
          style={[
            styles.glassHighlight,
            {
              right: Math.round(bodyWidth * 0.14),
              width: Math.round(bodyWidth * 0.14),
              height: Math.round(bodyHeight * 0.72),
              borderRadius: Math.round(bodyWidth * 0.07),
            },
          ]}
        />
        <View style={[styles.glassBaseLine, { width: bodyWidth * 0.84 }]} />
      </View>
    </View>
  );
}

function AmpouleShape({
  colorPrimary,
  colorAccent,
  size,
  testID,
}: {
  colorPrimary: string;
  colorAccent: string;
  size: number;
  testID?: string;
}): React.ReactElement {
  const bodyWidth = Math.round(size * 0.22);
  const bodyHeight = Math.round(size * 0.62);
  const tipHeight = Math.round(size * 0.18);

  return (
    <View style={[styles.wrap, { width: Math.round(size * 0.34), height: size }]} testID={testID}>
      <View
        style={[
          styles.ampouleTip,
          iconShadow,
          {
            borderBottomColor: colorPrimary,
            borderLeftWidth: Math.round(bodyWidth * 0.45),
            borderRightWidth: Math.round(bodyWidth * 0.45),
            borderBottomWidth: tipHeight,
          },
        ]}
      />
      <View
        style={[
          styles.ampouleBody,
          iconShadow,
          {
            width: bodyWidth,
            height: bodyHeight,
            borderBottomLeftRadius: Math.round(size * 0.05),
            borderBottomRightRadius: Math.round(size * 0.05),
            backgroundColor: colorPrimary,
          },
        ]}
      >
        <View
          style={[
            styles.ampouleBand,
            {
              backgroundColor: colorAccent,
              width: bodyWidth,
              height: Math.max(4, Math.round(bodyHeight * 0.22)),
            },
          ]}
        />
        <View style={[styles.glassHighlight, { width: bodyWidth * 0.35, height: bodyHeight * 0.45, left: '18%' }]} />
      </View>
    </View>
  );
}

const iconShadow: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.16,
  shadowRadius: 1.5,
  elevation: 2,
};

function shadeHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return hex;
  }
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  const next = channels.map((channel) => {
    const value = Math.round(channel + 255 * amount);
    return Math.min(255, Math.max(0, value));
  });
  return `#${next.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function glassTint(hex: string): string {
  return shadeHex(hex, 0.45);
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  vialCap: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -1,
  },
  capRib: {
    position: 'absolute',
    height: StyleSheet.hairlineWidth * 2,
    borderRadius: 1,
    opacity: 0.55,
  },
  capHighlight: {
    position: 'absolute',
    top: '12%',
    right: '12%',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  vialShoulder: {
    marginBottom: -1,
  },
  glassBody: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  liquidFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    opacity: 0.92,
  },
  liquidMeniscus: {},
  glassHighlight: {
    position: 'absolute',
    top: '12%',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  glassBaseLine: {
    position: 'absolute',
    bottom: 3,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  ampouleTip: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopWidth: 0,
    marginBottom: -1,
  },
  ampouleBody: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ampouleBand: {
    position: 'absolute',
    top: '38%',
  },
});
