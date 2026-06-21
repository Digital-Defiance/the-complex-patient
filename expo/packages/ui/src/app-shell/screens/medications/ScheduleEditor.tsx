import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { MedicationDraft } from '../../medications-ui';
import { WEEKDAYS, draftDoseAmount } from '../../medications-ui';

export interface ScheduleEditorProps {
  draft: MedicationDraft;
  onChange: (patch: Partial<MedicationDraft>) => void;
}

const SCHEDULE_KINDS = [
  { kind: 'weekly' as const, label: 'Weekly' },
  { kind: 'alternating' as const, label: 'Every other day' },
  { kind: 'rotating-interval' as const, label: 'Every N days' },
  { kind: 'taper' as const, label: 'Taper' },
  { kind: 'prn' as const, label: 'As needed (PRN)' },
];

export function ScheduleEditor({ draft, onChange }: ScheduleEditorProps): React.ReactElement {
  const doseUnit = draft.dosageUnit.trim() || 'dose';

  return (
    <View style={styles.wrap} testID="schedule-editor">
      <Text style={styles.label}>Schedule</Text>
      <View style={styles.kindRow}>
        {SCHEDULE_KINDS.map(({ kind, label }) => (
          <Pressable
            key={kind}
            style={[styles.kindChip, draft.scheduleKind === kind && styles.chipSelected]}
            onPress={() => {
              if (kind === 'prn') {
                const doseAmount = draftDoseAmount(draft);
                onChange({
                  scheduleKind: kind,
                  prnSafetyLimit: draft.prnSafetyLimit || String(doseAmount * 3),
                });
              } else {
                onChange({ scheduleKind: kind });
              }
            }}
            accessibilityRole="button"
            testID={`schedule-kind-${kind}`}
          >
            <Text style={styles.chipText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {draft.scheduleKind === 'weekly' && (
        <View style={styles.section}>
          <Text style={styles.subLabel}>Days</Text>
          <View style={styles.kindRow}>
            {WEEKDAYS.map((day) => {
              const selected = draft.weeklyDays.includes(day);
              return (
                <Pressable
                  key={day}
                  style={[styles.dayChip, selected && styles.chipSelected]}
                  onPress={() =>
                    onChange({
                      weeklyDays: selected
                        ? draft.weeklyDays.filter((value) => value !== day)
                        : [...draft.weeklyDays, day],
                    })
                  }
                  testID={`schedule-day-${day}`}
                >
                  <Text style={styles.chipText}>{day}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {draft.scheduleKind === 'alternating' && (
        <LabeledInput
          label="Start date (YYYY-MM-DD)"
          value={draft.alternatingStartDate}
          onChangeText={(alternatingStartDate) => onChange({ alternatingStartDate })}
          testID="schedule-alternating-start"
        />
      )}

      {draft.scheduleKind === 'rotating-interval' && (
        <LabeledInput
          label="Every N days (1–30)"
          value={draft.rotatingEveryNDays}
          onChangeText={(rotatingEveryNDays) => onChange({ rotatingEveryNDays })}
          testID="schedule-rotating-n"
        />
      )}

      {draft.scheduleKind === 'taper' && (
        <LabeledInput
          label="Taper phases (one dosage per line, by week)"
          value={draft.taperPhases}
          onChangeText={(taperPhases) => onChange({ taperPhases })}
          multiline
          testID="schedule-taper-phases"
        />
      )}

      {draft.scheduleKind !== 'prn' && draft.scheduleKind !== 'taper' && (
        <LabeledInput
          label="Times (comma-separated, 24h HH:mm)"
          value={draft.weeklyTimes}
          onChangeText={(weeklyTimes) => onChange({ weeklyTimes })}
          testID="schedule-times"
        />
      )}

      {draft.scheduleKind === 'prn' && (
        <View style={styles.section}>
          <Text style={styles.helpText}>
            PRN only changes when you may take this med. Each quick log records your dosage above ({draft.dosageAmount || '1'}{' '}
            {doseUnit}).
          </Text>
          <LabeledInput
            label={`Max ${doseUnit} in 24 hours`}
            value={draft.prnSafetyLimit}
            onChangeText={(prnSafetyLimit) => onChange({ prnSafetyLimit })}
            testID="prn-limit"
          />
          <LabeledInput
            label="Optional reminder windows (comma-separated, 24h HH:mm)"
            value={draft.weeklyTimes}
            onChangeText={(weeklyTimes) => onChange({ weeklyTimes })}
            testID="prn-times"
          />
          <Text style={styles.helpText}>
            Leave reminder windows blank for fully as-needed use. Windows are optional cues — you can still log outside them.
          </Text>
        </View>
      )}
    </View>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  testID?: string;
  multiline?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.subLabel}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline && styles.multiline]}
        value={props.value}
        onChangeText={props.onChangeText}
        multiline={props.multiline}
        testID={props.testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  section: { gap: 8 },
  label: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  subLabel: { fontSize: 13, fontWeight: '600', color: '#555' },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#ddd' },
  dayChip: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#ddd' },
  chipSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  chipText: { fontSize: 12, color: '#333' },
  helpText: { fontSize: 12, color: '#666', lineHeight: 17 },
  inputWrap: { gap: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 14 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
