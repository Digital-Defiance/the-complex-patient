import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { MedAppearance } from '@complex-patient/domain';
import {
  MedProductIcon,
  PILL_COLOR_PRESETS,
  PILL_SHAPES,
  resolveMedProductKind,
  hasCustomizableMedAppearance,
  type MedProductKind,
} from '@complex-patient/med-visuals';

export interface PillAppearancePickerProps {
  value: MedAppearance;
  onChange: (next: MedAppearance) => void;
  form?: string;
  dosageUnit?: string;
}

function ColorSwatches({
  label,
  selected,
  onSelect,
  testIDPrefix,
}: {
  label: string;
  selected: string;
  onSelect: (color: string) => void;
  testIDPrefix: string;
}): React.ReactElement {
  return (
    <View style={styles.colorSection}>
      <Text style={styles.subLabel}>{label}</Text>
      <View style={styles.colorRow}>
        {PILL_COLOR_PRESETS.map((color) => (
          <Pressable
            key={`${testIDPrefix}-${color}`}
            style={[styles.colorSwatch, { backgroundColor: color }, selected === color && styles.colorSelected]}
            onPress={() => onSelect(color)}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${color}`}
            testID={`${testIDPrefix}-${color.slice(1)}`}
          />
        ))}
      </View>
    </View>
  );
}

const CONTAINER_APPEARANCE: Record<
  Exclude<MedProductKind, 'pill' | 'generic'>,
  { title: string; preview: string; bodyLabel: string; accentLabel: string; bodyPrefix: string; accentPrefix: string }
> = {
  spray: {
    title: 'Bottle appearance',
    preview: 'nasal spray',
    bodyLabel: 'Bottle color',
    accentLabel: 'Label window',
    bodyPrefix: 'spray-color-body',
    accentPrefix: 'spray-color-accent',
  },
  vial: {
    title: 'Vial appearance',
    preview: 'vial',
    bodyLabel: 'Glass color',
    accentLabel: 'Liquid / label',
    bodyPrefix: 'vial-color-glass',
    accentPrefix: 'vial-color-liquid',
  },
  ampoule: {
    title: 'Ampoule appearance',
    preview: 'ampoule',
    bodyLabel: 'Glass color',
    accentLabel: 'Band color',
    bodyPrefix: 'ampoule-color-glass',
    accentPrefix: 'ampoule-color-band',
  },
  patch: {
    title: 'Patch appearance',
    preview: 'transdermal patch',
    bodyLabel: 'Patch color',
    accentLabel: 'Label band',
    bodyPrefix: 'patch-color-body',
    accentPrefix: 'patch-color-band',
  },
  drop: {
    title: 'Dropper appearance',
    preview: 'eye / ear drops',
    bodyLabel: 'Bottle color',
    accentLabel: 'Liquid / drop',
    bodyPrefix: 'drop-color-bottle',
    accentPrefix: 'drop-color-liquid',
  },
};

function ContainerAppearancePicker({
  kind,
  value,
  onChange,
  form,
  dosageUnit,
}: {
  kind: Exclude<MedProductKind, 'pill' | 'generic'>;
  value: PillAppearancePickerProps['value'];
  onChange: PillAppearancePickerProps['onChange'];
  form: string;
  dosageUnit: string;
}): React.ReactElement {
  const copy = CONTAINER_APPEARANCE[kind];
  const secondaryColor = value.colorSecondary ?? value.colorPrimary;
  const previewSize = kind === 'spray' || kind === 'drop' ? 52 : 44;

  return (
    <View style={styles.wrap} testID="pill-appearance-picker">
      <Text style={styles.label}>{copy.title}</Text>
      <View style={styles.previewRow}>
        <MedProductIcon
          appearance={value}
          form={form}
          dosageUnit={dosageUnit}
          size={previewSize}
          presentation="flat"
          testID="pill-appearance-preview"
        />
        <Text style={styles.previewText}>{copy.preview}</Text>
      </View>
      <ColorSwatches
        label={copy.bodyLabel}
        selected={value.colorPrimary}
        onSelect={(colorPrimary) => onChange({ ...value, colorPrimary })}
        testIDPrefix={copy.bodyPrefix}
      />
      <ColorSwatches
        label={copy.accentLabel}
        selected={secondaryColor}
        onSelect={(colorSecondary) => onChange({ ...value, colorSecondary })}
        testIDPrefix={copy.accentPrefix}
      />
    </View>
  );
}

export function PillAppearancePicker({
  value,
  onChange,
  form = '',
  dosageUnit = '',
}: PillAppearancePickerProps): React.ReactElement {
  const productKind = resolveMedProductKind(form, dosageUnit);
  const isCapsule = value.shape === 'capsule';
  const secondaryColor = value.colorSecondary ?? value.colorPrimary;

  if (!hasCustomizableMedAppearance(productKind)) {
    return null;
  }

  if (productKind !== 'pill') {
    return (
      <ContainerAppearancePicker
        kind={productKind}
        value={value}
        onChange={onChange}
        form={form}
        dosageUnit={dosageUnit}
      />
    );
  }

  return (
    <View style={styles.wrap} testID="pill-appearance-picker">
      <Text style={styles.label}>Pill appearance</Text>
      <View style={styles.previewRow}>
        <MedProductIcon
          appearance={value}
          form={form}
          dosageUnit={dosageUnit}
          size={40}
          presentation="flat"
          testID="pill-appearance-preview"
        />
        <Text style={styles.previewText}>{value.shape}</Text>
      </View>

      <Text style={styles.subLabel}>Shape</Text>
      <View style={styles.shapeRow}>
        {PILL_SHAPES.map((shape) => (
          <Pressable
            key={shape}
            style={[styles.shapeChip, value.shape === shape && styles.chipSelected]}
            onPress={() => {
              if (shape === 'capsule') {
                onChange({
                  ...value,
                  shape,
                  colorSecondary: value.colorSecondary ?? value.colorPrimary,
                });
                return;
              }
              onChange({ ...value, shape, colorSecondary: value.colorPrimary });
            }}
            accessibilityRole="button"
            testID={`pill-shape-${shape}`}
          >
            <Text style={styles.chipText}>{shape}</Text>
          </Pressable>
        ))}
      </View>

      {isCapsule ? (
        <>
          <ColorSwatches
            label="Left half"
            selected={value.colorPrimary}
            onSelect={(colorPrimary) => onChange({ ...value, colorPrimary })}
            testIDPrefix="pill-color-left"
          />
          <ColorSwatches
            label="Right half"
            selected={secondaryColor}
            onSelect={(colorSecondary) => onChange({ ...value, colorSecondary })}
            testIDPrefix="pill-color-right"
          />
        </>
      ) : (
        <ColorSwatches
          label="Color"
          selected={value.colorPrimary}
          onSelect={(color) => onChange({ ...value, colorPrimary: color, colorSecondary: color })}
          testIDPrefix="pill-color"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  label: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  subLabel: { fontSize: 13, fontWeight: '600', color: '#555' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewText: { fontSize: 14, color: '#444', textTransform: 'capitalize' },
  shapeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shapeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  chipSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  chipText: { fontSize: 13, color: '#333', textTransform: 'capitalize' },
  colorSection: { gap: 6 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#ddd' },
  colorSelected: { borderWidth: 3, borderColor: '#111' },
});
