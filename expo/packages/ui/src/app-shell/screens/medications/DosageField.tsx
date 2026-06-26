import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { DEFAULT_DOSAGE_UNIT, DOSAGE_UNITS, isPresetDosageUnit } from '../../dosage-units';
import { keyboardDoneAccessoryProps } from '../../ios-keyboard-done-accessory';

export interface DosageFieldProps {
  amount: string;
  unit: string;
  onAmountChange: (amount: string) => void;
  onUnitChange: (unit: string) => void;
  testIDPrefix?: string;
}

export function DosageField({
  amount,
  unit,
  onAmountChange,
  onUnitChange,
  testIDPrefix = 'med-dosage',
}: DosageFieldProps): React.ReactElement {
  return (
    <View style={styles.wrap} testID={`${testIDPrefix}-field`}>
      <Text style={styles.label}>Dosage</Text>
      <TextInput
        style={styles.amountInput}
        value={amount}
        onChangeText={onAmountChange}
        placeholder="Amount"
        keyboardType="decimal-pad"
        accessibilityLabel="Dosage amount"
        testID={`${testIDPrefix}-amount`}
        {...keyboardDoneAccessoryProps()}
      />
      <UnitSelector value={unit} onChange={onUnitChange} testIDPrefix={`${testIDPrefix}-unit`} />
    </View>
  );
}

export interface UnitSelectorProps {
  label?: string;
  value: string;
  onChange: (unit: string) => void;
  testIDPrefix?: string;
}

export function UnitSelector({
  label = 'Unit',
  value,
  onChange,
  testIDPrefix = 'dose-unit',
}: UnitSelectorProps): React.ReactElement {
  const [customMode, setCustomMode] = useState(() => !isPresetDosageUnit(value.trim() || DEFAULT_DOSAGE_UNIT));
  const activePreset = customMode ? null : value.trim() || DEFAULT_DOSAGE_UNIT;

  return (
    <View style={styles.wrap}>
      <Text style={styles.subLabel}>{label}</Text>
      <View style={styles.unitRow}>
        {DOSAGE_UNITS.map((option) => (
          <Pressable
            key={option}
            style={[styles.unitChip, activePreset === option && styles.chipSelected]}
            onPress={() => {
              setCustomMode(false);
              onChange(option);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: activePreset === option }}
            testID={`${testIDPrefix}-${option}`}
          >
            <Text style={styles.chipText}>{option}</Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.unitChip, customMode && styles.chipSelected]}
          onPress={() => {
            setCustomMode(true);
            if (!customMode) {
              onChange('');
            }
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: customMode }}
          testID={`${testIDPrefix}-other`}
        >
          <Text style={styles.chipText}>other</Text>
        </Pressable>
      </View>
      {customMode && (
        <TextInput
          style={styles.customUnitInput}
          value={value}
          onChangeText={onChange}
          placeholder="e.g. puff, application"
          accessibilityLabel="Custom dosage unit"
          testID={`${testIDPrefix}-other-input`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#555' },
  subLabel: { fontSize: 13, fontWeight: '600', color: '#555' },
  amountInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  customUnitInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unitChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  chipSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  chipText: { fontSize: 12, color: '#333' },
});
