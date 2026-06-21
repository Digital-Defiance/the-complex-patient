/**
 * Parametric pill renderer — Samsung Health / Apple Health style without image assets.
 *
 * Pills are drawn from shape + color (no NDC photo library). The "health" presentation
 * adds a circular well and light highlight for depth, matching common med-app UX.
 */

import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import type { MedAppearance } from '@complex-patient/domain';

export const DEFAULT_MED_APPEARANCE: MedAppearance = {
  shape: 'capsule',
  colorPrimary: '#e8e8e8',
  colorSecondary: '#d4d4d4',
};

export const PILL_COLOR_PRESETS: readonly string[] = [
  '#f5f5f5',
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#fde047',
  '#ea580c',
  '#f472b6',
  '#fb7185',
  '#92400e',
  '#9333ea',
  '#0891b2',
  '#64748b',
] as const;

export type PillPresentation = 'flat' | 'health';

export interface PillIconProps {
  appearance?: MedAppearance;
  size?: number;
  /** `health` = circular well + soft highlight (Samsung/Apple-style lists). */
  presentation?: PillPresentation;
  testID?: string;
}

export function PillIcon({
  appearance = DEFAULT_MED_APPEARANCE,
  size = 36,
  presentation = 'health',
  testID,
}: PillIconProps): React.ReactElement {
  const pill = (
    <PillShape appearance={appearance} size={size} testID={testID ? `${testID}-shape` : undefined} />
  );

  if (presentation === 'flat') {
    return pill;
  }

  const wellSize = Math.round(size * 1.65);
  return (
    <View
      style={[styles.well, { width: wellSize, height: wellSize, borderRadius: wellSize / 2 }]}
      testID={testID}
    >
      {pill}
    </View>
  );
}

function PillShape({
  appearance,
  size,
  testID,
}: {
  appearance: MedAppearance;
  size: number;
  testID?: string;
}): React.ReactElement {
  const primary = appearance.colorPrimary;
  const secondary = appearance.colorSecondary ?? shade(primary, -0.12);

  if (appearance.shape === 'capsule') {
    const width = size * 1.45;
    const height = size * 0.52;
    return (
      <View style={[styles.capsule, pillShadow, { width, height, borderRadius: height }]} testID={testID}>
        <View style={[styles.capsuleHalf, { backgroundColor: primary, borderTopLeftRadius: height, borderBottomLeftRadius: height }]}>
          <Highlight width={width / 2} height={height} />
        </View>
        <View style={[styles.capsuleSeam]} />
        <View style={[styles.capsuleHalf, { backgroundColor: secondary, borderTopRightRadius: height, borderBottomRightRadius: height }]}>
          <Highlight width={width / 2} height={height} />
        </View>
      </View>
    );
  }

  if (appearance.shape === 'round') {
    return (
      <View style={[pillShadow, { width: size * 0.72, height: size * 0.72, borderRadius: size, backgroundColor: primary, overflow: 'hidden' }]} testID={testID}>
        <Highlight width={size * 0.72} height={size * 0.72} />
      </View>
    );
  }

  if (appearance.shape === 'oval') {
    const width = size * 1.05;
    const height = size * 0.58;
    return (
      <View
        style={[pillShadow, { width, height, borderRadius: height, backgroundColor: primary, overflow: 'hidden' }]}
        testID={testID}
      >
        <Highlight width={width} height={height} />
      </View>
    );
  }

  const width = size * 0.95;
  const height = size * 0.48;
  return (
    <View
      style={[styles.tablet, pillShadow, { width, height, borderRadius: height * 0.22, backgroundColor: primary }]}
      testID={testID}
    >
      <Highlight width={width} height={height} />
      <View style={[styles.scoreLine, styles.scoreHorizontal, { width: width * 0.72 }]} />
      <View style={[styles.scoreLine, styles.scoreVertical, { height: height * 0.62 }]} />
    </View>
  );
}

function Highlight({ width, height }: { width: number; height: number }): React.ReactElement {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: height * 0.12,
        left: width * 0.14,
        width: width * 0.55,
        height: height * 0.28,
        borderRadius: height,
        backgroundColor: 'rgba(255,255,255,0.42)',
      }}
    />
  );
}

function shade(hex: string, amount: number): string {
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

const pillShadow: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.22,
  shadowRadius: 1.5,
  elevation: 2,
};

const styles = StyleSheet.create({
  well: {
    backgroundColor: '#e8eaed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsule: {
    flexDirection: 'row',
    overflow: 'hidden',
  },
  capsuleHalf: {
    flex: 1,
    overflow: 'hidden',
  },
  capsuleSeam: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  tablet: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  scoreLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  scoreHorizontal: {
    height: StyleSheet.hairlineWidth,
  },
  scoreVertical: {
    width: StyleSheet.hairlineWidth,
  },
});

export const PILL_SHAPES: readonly MedAppearance['shape'][] = ['capsule', 'round', 'oval', 'tablet'] as const;
