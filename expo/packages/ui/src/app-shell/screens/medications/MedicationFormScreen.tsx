/**
 * Add / edit medication wizard.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { VaultRecord } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import { validateMedicationProfile, validateMedicationSchedule, validatePrnSafetyLimit } from '@complex-patient/domain';
import { useAppHost } from '../../app-host';
import { usePartition } from '../../hooks';
import {
  buildProfileFromDraft,
  draftFromProfile,
  emptyMedicationDraft,
  mergeMedicationRecord,
  suggestConditionsTreated,
  suggestPrescribingPhysicians,
  type MedicationDraft,
} from '../../medications-ui';
import { formatDosageString } from '../../dosage-units';
import { PillAppearancePicker } from './PillAppearancePicker';
import { DosageField } from './DosageField';
import { ScheduleEditor } from './ScheduleEditor';

export interface MedicationFormScreenProps {
  medicationId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function MedicationFormScreen({
  medicationId,
  onSaved,
  onCancel,
}: MedicationFormScreenProps): React.ReactElement {
  const { home } = useAppHost();
  if (!home) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Data unavailable.</Text>
      </View>
    );
  }
  return (
    <MedicationFormInner home={home} medicationId={medicationId} onSaved={onSaved} onCancel={onCancel} />
  );
}

function MedicationFormInner({
  home,
  medicationId,
  onSaved,
  onCancel,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
  medicationId?: string;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const records = usePartition<VaultRecord>(home, 'medications');
  const medications = useMemo(() => splitMedicationsPartition(records).medications, [records]);
  const existing = useMemo(() => {
    return medicationId ? medications.find((med) => med.id === medicationId) : undefined;
  }, [medications, medicationId]);

  const [draft, setDraft] = useState<MedicationDraft>(() =>
    existing ? draftFromProfile(existing) : emptyMedicationDraft(),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const physicianSuggestions = useMemo(
    () => suggestPrescribingPhysicians(medications, draft.prescribingPhysician),
    [medications, draft.prescribingPhysician],
  );

  const conditionSuggestions = useMemo(
    () => suggestConditionsTreated(medications, draft.conditionTreated),
    [medications, draft.conditionTreated],
  );

  const patchDraft = useCallback((patch: Partial<MedicationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFieldError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const profileShape = {
      drugName: draft.drugName,
      dosage: formatDosageString(draft.dosageAmount, draft.dosageUnit),
      form: draft.form,
      prescribingPhysician: draft.prescribingPhysician,
      conditionTreated: draft.conditionTreated,
    };
    const profileValidation = validateMedicationProfile(profileShape);
    if (!profileValidation.valid) {
      setFieldError(profileValidation.errors.map((entry) => entry.field).join(', ') + ' invalid');
      return;
    }

    const schedule = buildProfileFromDraft(draft, existing).schedule;
    const scheduleValidation = validateMedicationSchedule(schedule);
    if (!scheduleValidation.valid) {
      setFieldError(scheduleValidation.message);
      return;
    }

    const built = buildProfileFromDraft(draft, existing);
    if (built.prn) {
      const prnValidation = validatePrnSafetyLimit(built.prn.safetyLimit24h);
      if (!prnValidation.valid) {
        setFieldError(prnValidation.message);
        return;
      }
    }

    setSaving(true);
    const result = await home.commit<VaultRecord>('medications', (current) =>
      mergeMedicationRecord(current, built),
    );
    setSaving(false);

    if (result.ok) {
      onSaved();
    } else {
      setFieldError('Changes were not saved.');
    }
  }, [draft, existing, home, onSaved]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{existing ? 'Edit medication' : 'Add medication'}</Text>

      {fieldError && (
        <Text style={styles.error} accessibilityRole="alert" testID="medication-form-error">
          {fieldError}
        </Text>
      )}

      <Field label="Drug name" value={draft.drugName} onChange={(drugName) => patchDraft({ drugName })} testID="med-drug-name" />
      <DosageField
        amount={draft.dosageAmount}
        unit={draft.dosageUnit}
        onAmountChange={(dosageAmount) => patchDraft({ dosageAmount })}
        onUnitChange={(dosageUnit) => patchDraft({ dosageUnit })}
      />
      <Text style={styles.fieldHelp}>
        How much you take each time (e.g. 1 capsule, 2 spray). For PRN, scheduling below controls how often — not a separate dose.
      </Text>
      <Field label="Form" value={draft.form} onChange={(form) => patchDraft({ form })} testID="med-form" />
      <AutocompleteField
        label="Prescribing physician"
        optional
        value={draft.prescribingPhysician}
        onChange={(prescribingPhysician) => patchDraft({ prescribingPhysician })}
        suggestions={physicianSuggestions}
        testID="med-physician"
        suggestionsTestID="med-physician-suggestions"
      />
      <AutocompleteField
        label="Condition treated"
        optional
        value={draft.conditionTreated}
        onChange={(conditionTreated) => patchDraft({ conditionTreated })}
        suggestions={conditionSuggestions}
        testID="med-condition"
        suggestionsTestID="med-condition-suggestions"
      />

      <ScheduleEditor draft={draft} onChange={patchDraft} />
      <PillAppearancePicker
        value={draft.appearance}
        onChange={(appearance) => patchDraft({ appearance })}
        form={draft.form}
        dosageUnit={draft.dosageUnit}
      />

      <Text style={styles.sectionTitle}>Refill tracking</Text>
      <Field label="Quantity on hand" value={draft.quantityOnHand} onChange={(quantityOnHand) => patchDraft({ quantityOnHand })} testID="med-qty" />
      <Field label="Low stock alert at" value={draft.lowStockThreshold} onChange={(lowStockThreshold) => patchDraft({ lowStockThreshold })} testID="med-low-stock" />
      <Field label="Product code / barcode (manual)" value={draft.productCode} onChange={(productCode) => patchDraft({ productCode })} testID="med-product-code" />

      <View style={styles.actions}>
        <Pressable style={styles.saveBtn} onPress={() => void handleSave()} disabled={saving} testID="medication-form-save">
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={onCancel} testID="medication-form-cancel">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function SuggestionList({
  suggestions,
  onSelect,
  testID,
}: {
  suggestions: string[];
  onSelect: (value: string) => void;
  testID: string;
}): React.ReactElement | null {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <View style={styles.suggestionList} testID={testID}>
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion}
          style={styles.suggestionItem}
          onPress={() => onSelect(suggestion)}
          accessibilityRole="button"
          testID={`${testID}-${suggestion.replace(/\s+/g, '-').toLowerCase()}`}
        >
          <Text style={styles.suggestionText}>{suggestion}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AutocompleteField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  testID?: string;
  suggestionsTestID: string;
  optional?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {props.label}
        {props.optional ? ' (optional)' : ''}
      </Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChange}
        autoCapitalize="words"
        testID={props.testID}
      />
      <SuggestionList
        suggestions={props.suggestions}
        onSelect={props.onChange}
        testID={props.suggestionsTestID}
      />
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testID?: string;
  optional?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {props.label}
        {props.optional ? ' (optional)' : ''}
      </Text>
      <TextInput style={styles.input} value={props.value} onChangeText={props.onChange} testID={props.testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, gap: 12, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginTop: 8 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#555' },
  fieldHelp: { fontSize: 12, color: '#666', marginTop: -4, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 14 },
  suggestionList: {
    borderWidth: 1,
    borderColor: '#d0e3f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fbff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0e3f5',
  },
  suggestionText: {
    fontSize: 14,
    color: '#0066cc',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  saveBtn: { flex: 1, backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '600' },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, alignItems: 'center' },
  cancelText: { color: '#555' },
  error: { color: '#c00', marginBottom: 8 },
});
