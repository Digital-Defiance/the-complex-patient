/**
 * Add / edit medication wizard.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { VaultRecord } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import {
  validateMedicationProfile,
  validateMedicationSchedule,
  validatePrnConfig,
} from '@complex-patient/domain';
import {
  buildConfirmedRxIdentity,
  buildDeclinedRxIdentity,
  DRUG_NAMING_ASSIST_ENABLED,
  getConceptByRxcui,
  getDrugNamingCatalog,
  matchMedicationName,
  resolveRxcuiFromNdc,
  searchDrugNameSuggestions,
  type RxMatchCandidate,
} from '@complex-patient/drug-naming';
import { useAppHost } from '../../app-host';
import {
  IosKeyboardDoneAccessory,
  keyboardDoneAccessoryProps,
} from '../../ios-keyboard-done-accessory';
import { usePartition } from '../../hooks';
import {
  buildProfileFromDraft,
  draftFromProfile,
  emptyMedicationDraft,
  emptyRegimenDraft,
  applyBarcodeScanToDraft,
  applyDrugNameChangeToDraft,
  applyProductCodeChangeToDraft,
  medicationIdentityBaseline,
  EMPTY_RX_DRAFT_FIELDS,
  shouldInvalidateConfirmedRxMatch,
  shouldShowRxMatchConfirmPanel,
  MEDICATION_FORMS,
  mergeMedicationRecord,
  REGIMEN_LABEL_PRESETS,
  suggestConditionsTreated,
  suggestPrescribingPhysicians,
  type MedicationDraft,
  type RegimenDraft,
} from '../../medications-ui';
import { PillAppearancePicker } from './PillAppearancePicker';
import { DosageField } from './DosageField';
import { ScheduleEditor } from './ScheduleEditor';
import { DrugNamingDisclaimer } from './DrugNamingDisclaimer';
import { RxMatchConfirmPanel } from './RxMatchConfirmPanel';
import { MedProductCodeScanner } from './MedProductCodeScanner';

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
  const [pendingCandidate, setPendingCandidate] = useState<RxMatchCandidate | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

  const identityBaseline = useMemo(
    () => medicationIdentityBaseline(existing),
    [existing],
  );

  const clearRxDraftFields = useCallback(() => EMPTY_RX_DRAFT_FIELDS, []);

  useEffect(() => {
    if (!DRUG_NAMING_ASSIST_ENABLED || draft.userConfirmedRxMatch !== true || !pendingCandidate) {
      return;
    }
    if (shouldInvalidateConfirmedRxMatch(draft, pendingCandidate.rxcui)) {
      setDraft((current) => ({
        ...current,
        ...clearRxDraftFields(),
      }));
    }
  }, [clearRxDraftFields, draft, pendingCandidate]);

  const drugNameSuggestions = useMemo(() => {
    if (!DRUG_NAMING_ASSIST_ENABLED) return [];
    return searchDrugNameSuggestions(draft.drugName);
  }, [draft.drugName]);

  useEffect(() => {
    if (!DRUG_NAMING_ASSIST_ENABLED) {
      setPendingCandidate(null);
      return;
    }
    const ndcRxcui = draft.productCode.trim() ? resolveRxcuiFromNdc(draft.productCode) : null;
    const result = matchMedicationName(draft.drugName, { rxcuiHint: ndcRxcui ?? undefined });
    setPendingCandidate(result.candidate);
  }, [draft.drugName, draft.productCode]);

  const applyConfirmedMatch = useCallback((candidate: RxMatchCandidate) => {
    const identity = buildConfirmedRxIdentity(candidate);
    setDraft((current) => ({
      ...current,
      rxcui: identity.rxcui,
      ingredientRxcui: identity.ingredientRxcui,
      rxDisplayName: identity.rxDisplayName,
      rxMatchConfidence: String(identity.rxMatchConfidence),
      userConfirmedRxMatch: true,
      rxnormDatasetVersion: identity.rxnormDatasetVersion,
    }));
    setFieldError(null);
  }, []);

  const applyDeclinedMatch = useCallback(() => {
    const declined = buildDeclinedRxIdentity();
    setDraft((current) => ({
      ...current,
      rxcui: '',
      ingredientRxcui: '',
      rxDisplayName: '',
      rxMatchConfidence: '',
      userConfirmedRxMatch: false,
      rxnormDatasetVersion: declined.rxnormDatasetVersion,
    }));
  }, []);

  const handleDrugNameChange = useCallback(
    (drugName: string) => {
      setDraft((current) => applyDrugNameChangeToDraft(current, identityBaseline, drugName));
      setFieldError(null);
    },
    [identityBaseline],
  );

  const handleProductCodeChange = useCallback(
    (productCode: string) => {
      setDraft((current) => applyProductCodeChangeToDraft(current, identityBaseline, productCode));
      setFieldError(null);
    },
    [identityBaseline],
  );

  const handleBarcodeScan = useCallback(
    (rawCode: string) => {
      const rxcui = resolveRxcuiFromNdc(rawCode);
      const concept = rxcui ? getConceptByRxcui(getDrugNamingCatalog(), rxcui) : undefined;
      setDraft((current) =>
        applyBarcodeScanToDraft(current, identityBaseline, rawCode, concept?.displayName),
      );
      setFieldError(null);
    },
    [identityBaseline],
  );

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

  const patchRegimen = useCallback((regimenId: string, patch: Partial<RegimenDraft>) => {
    setDraft((current) => ({
      ...current,
      regimens: current.regimens.map((regimen) =>
        regimen.id === regimenId ? { ...regimen, ...patch } : regimen,
      ),
    }));
    setFieldError(null);
  }, []);

  const addRegimen = useCallback((preset?: { label?: string; times?: string }) => {
    setDraft((current) => ({
      ...current,
      regimens: [...current.regimens, emptyRegimenDraft(preset)],
    }));
    setFieldError(null);
  }, []);

  const removeRegimen = useCallback((regimenId: string) => {
    setDraft((current) => {
      if (current.regimens.length <= 1) return current;
      return { ...current, regimens: current.regimens.filter((regimen) => regimen.id !== regimenId) };
    });
    setFieldError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const built = buildProfileFromDraft(draft, existing);
    const profileValidation = validateMedicationProfile(built);
    if (!profileValidation.valid) {
      setFieldError(profileValidation.errors.map((entry) => entry.message).join('; '));
      return;
    }

    for (const regimen of built.regimens) {
      const scheduleValidation = validateMedicationSchedule(regimen.schedule);
      if (!scheduleValidation.valid) {
        setFieldError(scheduleValidation.message);
        return;
      }
      if (regimen.prn) {
        const prnValidation = validatePrnConfig(regimen.prn);
        if (!prnValidation.valid) {
          setFieldError(prnValidation.message);
          return;
        }
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

  const primaryForm = draft.regimens[0]?.form ?? 'tablet';
  const primaryUnit = draft.regimens[0]?.dosageUnit ?? 'mg';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <IosKeyboardDoneAccessory />

      <Text style={styles.title}>{existing ? 'Edit medication' : 'Add medication'}</Text>

      {fieldError && (
        <Text style={styles.error} accessibilityRole="alert" testID="medication-form-error">
          {fieldError}
        </Text>
      )}

      {DRUG_NAMING_ASSIST_ENABLED ? <DrugNamingDisclaimer /> : null}

      {DRUG_NAMING_ASSIST_ENABLED ? (
        <>
          <AutocompleteField
            label="Drug name"
            value={draft.drugName}
            onChange={handleDrugNameChange}
            suggestions={drugNameSuggestions}
            testID="med-drug-name"
            suggestionsTestID="med-drug-name-suggestions"
          />
          {shouldShowRxMatchConfirmPanel(draft, pendingCandidate) ? (
            <RxMatchConfirmPanel
              typedName={draft.drugName}
              candidate={pendingCandidate}
              confirmed={draft.userConfirmedRxMatch}
              onConfirm={() => pendingCandidate && applyConfirmedMatch(pendingCandidate)}
              onDecline={applyDeclinedMatch}
              onUnsure={applyDeclinedMatch}
            />
          ) : null}
        </>
      ) : (
        <Field
          label="Drug name"
          value={draft.drugName}
          onChange={handleDrugNameChange}
          testID="med-drug-name"
        />
      )}
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
      <Field
        label="Notes"
        optional
        value={draft.notes}
        onChange={(notes) => patchDraft({ notes })}
        testID="med-notes"
        multiline
      />

      <Text style={styles.sectionTitle}>Dose regimens</Text>
      <Text style={styles.fieldHelp}>
        Add one regimen per dose time (e.g. morning and bedtime for the same drug). All reminders share this medication entry.
      </Text>

      {draft.regimens.map((regimen, index) => (
        <View key={regimen.id} style={styles.regimenCard} testID={`regimen-card-${index}`}>
          <View style={styles.regimenHeader}>
            <Text style={styles.regimenTitle}>
              {regimen.label.trim() || `Dose ${index + 1}`}
            </Text>
            {draft.regimens.length > 1 && (
              <Pressable onPress={() => removeRegimen(regimen.id)} testID={`regimen-remove-${index}`}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            )}
          </View>

          <Field
            label="Label (optional)"
            optional
            value={regimen.label}
            onChange={(label) => patchRegimen(regimen.id, { label })}
            testID={`regimen-label-${index}`}
          />
          <View style={styles.presetRow}>
            {REGIMEN_LABEL_PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                style={styles.presetChip}
                onPress={() =>
                  patchRegimen(regimen.id, {
                    label: preset.label,
                    weeklyTimes: preset.times,
                    scheduleKind: 'weekly',
                  })
                }
                testID={`regimen-preset-${preset.label.toLowerCase()}-${index}`}
              >
                <Text style={styles.presetText}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>

          <DosageField
            amount={regimen.dosageAmount}
            unit={regimen.dosageUnit}
            onAmountChange={(dosageAmount) => patchRegimen(regimen.id, { dosageAmount })}
            onUnitChange={(dosageUnit) => patchRegimen(regimen.id, { dosageUnit })}
          />

          <Text style={styles.fieldLabel}>Form</Text>
          <View style={styles.formChipRow}>
            {MEDICATION_FORMS.map((form) => (
              <Pressable
                key={form}
                style={[styles.formChip, regimen.form === form && styles.chipSelected]}
                onPress={() => patchRegimen(regimen.id, { form })}
                testID={`regimen-form-${form}-${index}`}
              >
                <Text style={styles.chipText}>{form}</Text>
              </Pressable>
            ))}
          </View>

          <ScheduleEditor
            draft={regimen}
            onChange={(patch) => patchRegimen(regimen.id, patch)}
          />
        </View>
      ))}

      <View style={styles.addRegimenRow}>
        <Pressable style={styles.addRegimenBtn} onPress={() => addRegimen()} testID="add-regimen">
          <Text style={styles.addRegimenText}>+ Add another dose time</Text>
        </Pressable>
      </View>

      <PillAppearancePicker
        value={draft.appearance}
        onChange={(appearance) => patchDraft({ appearance })}
        form={primaryForm}
        dosageUnit={primaryUnit}
      />

      <Text style={styles.sectionTitle}>Refill tracking</Text>
      <Field label="Quantity on hand" value={draft.quantityOnHand} onChange={(quantityOnHand) => patchDraft({ quantityOnHand })} testID="med-qty" />
      <Field label="Low stock alert at" value={draft.lowStockThreshold} onChange={(lowStockThreshold) => patchDraft({ lowStockThreshold })} testID="med-low-stock" />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Product code / barcode</Text>
        <View style={styles.productCodeRow}>
          <TextInput
            style={[styles.input, styles.productCodeInput]}
            value={draft.productCode}
            onChangeText={handleProductCodeChange}
            placeholder="NDC or barcode digits"
            testID="med-product-code"
            keyboardType="number-pad"
            {...keyboardDoneAccessoryProps()}
          />
          {DRUG_NAMING_ASSIST_ENABLED ? (
            <Pressable
              style={styles.scanButton}
              onPress={() => setShowBarcodeScanner(true)}
              accessibilityRole="button"
              testID="med-product-code-scan"
            >
              <Text style={styles.scanButtonText}>Scan</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {showBarcodeScanner ? (
        <MedProductCodeScanner
          onScan={handleBarcodeScan}
          onClose={() => setShowBarcodeScanner(false)}
        />
      ) : null}

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
        {...keyboardDoneAccessoryProps()}
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
  multiline?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {props.label}
        {props.optional ? ' (optional)' : ''}
      </Text>
      <TextInput
        style={[styles.input, props.multiline && styles.multiline]}
        value={props.value}
        onChangeText={props.onChange}
        multiline={props.multiline}
        testID={props.testID}
        {...keyboardDoneAccessoryProps()}
      />
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
  productCodeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  productCodeInput: { flex: 1 },
  scanButton: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#eff6ff',
  },
  scanButtonText: { color: '#2563eb', fontWeight: '600', fontSize: 14 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  regimenCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    backgroundColor: '#fafafa',
  },
  regimenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  regimenTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  removeText: { color: '#c00', fontSize: 13, fontWeight: '600' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  presetText: { fontSize: 12, color: '#2563eb' },
  formChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  chipSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  chipText: { fontSize: 12, color: '#333' },
  addRegimenRow: { marginTop: 4 },
  addRegimenBtn: { paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, borderStyle: 'dashed' },
  addRegimenText: { color: '#2563eb', fontWeight: '600' },
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
