/**
 * @complex-patient/ui — MedicationsScreen
 *
 * Renders the adaptive medications view produced by `buildPolypharmacyView` in
 * the exact order returned — no blocks omitted, reordered, or inserted. When
 * zero medication profiles exist, displays an empty-medication-list message with
 * no medication rows. Persists edits exclusively through `home.commit('medications', …)`.
 * On commit failure, shows a "not saved" message and retains entered values.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.6, 9.7
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { buildMedicationsView, type PolyView, type PolyViewBlock } from '@complex-patient/medications';
import type { MedicationProfile, VaultRecord } from '@complex-patient/domain';
import { summarizeMedicationDosage, summarizeMedicationForm } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import { MedProductIcon } from '@complex-patient/med-visuals';
import { parseDosageString } from '../dosage-units';
import { useAppHost } from '../app-host';
import { usePartition } from '../hooks';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MedicationsScreenProps {
  /** Called when navigating back or to PRN screen. */
  onNavigatePrn?: () => void;
  onAdd?: () => void;
  onEditMedication?: (medicationId: string) => void;
  /** Called when navigating back to home. */
  onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Edit state for inline editing
// ---------------------------------------------------------------------------

interface EditState {
  medicationId: string;
  drugName: string;
  prescribingPhysician: string;
  conditionTreated: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MedicationsScreen({ onNavigatePrn, onAdd, onEditMedication, onBack }: MedicationsScreenProps): React.ReactElement {
  const { home } = useAppHost();

  // If home is not available, render the data-unavailable fallback.
  if (!home) {
    return (
      <View style={styles.container} testID="medications-screen">
        <Text style={styles.errorText} accessibilityRole="alert" testID="medications-data-unavailable">
          Data unavailable. Please try again later.
        </Text>
      </View>
    );
  }

  return (
    <MedicationsScreenInner
      home={home}
      onNavigatePrn={onNavigatePrn}
      onAdd={onAdd}
      onEditMedication={onEditMedication}
      onBack={onBack}
    />
  );
}

// ---------------------------------------------------------------------------
// Inner component — safe to call hooks unconditionally since home is guaranteed.
// ---------------------------------------------------------------------------

interface InnerProps {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
  onNavigatePrn?: () => void;
  onAdd?: () => void;
  onEditMedication?: (medicationId: string) => void;
  onBack?: () => void;
}

function MedicationsScreenInner({ home, onNavigatePrn, onAdd, onEditMedication, onBack }: InnerProps): React.ReactElement {
  const allRecords = usePartition<VaultRecord>(home, 'medications');
  const medications = useMemo(
    () => splitMedicationsPartition(allRecords).medications,
    [allRecords],
  );

  const polyView: PolyView = useMemo(() => buildMedicationsView(medications), [medications]);

  // Edit state — retains values on commit failure (Requirement 9.7).
  const [editing, setEditing] = useState<EditState | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Start editing a medication.
  const handleEdit = useCallback((med: MedicationProfile) => {
    setEditing({
      medicationId: med.id,
      drugName: med.drugName,
      prescribingPhysician: med.prescribingPhysician,
      conditionTreated: med.conditionTreated,
    });
    setCommitError(null);
  }, []);

  // Cancel editing.
  const handleCancelEdit = useCallback(() => {
    setEditing(null);
    setCommitError(null);
  }, []);

  // Save edited medication — persist exclusively through home.commit (Requirement 9.6).
  const handleSave = useCallback(async () => {
    if (!editing) return;

    const result = await home.commit<MedicationProfile>('medications', (current) =>
      current.map((med) =>
        med.id === editing.medicationId
          ? {
              ...med,
              drugName: editing.drugName,
              prescribingPhysician: editing.prescribingPhysician,
              conditionTreated: editing.conditionTreated,
              op_timestamp: new Date().toISOString(),
            }
          : med,
      ),
    );

    if (result.ok) {
      // Successful commit — clear edit state.
      setEditing(null);
      setCommitError(null);
    } else {
      // Requirement 9.7: on commit failure, show "not saved" message and retain values.
      setCommitError('Changes were not saved. Please try again.');
    }
  }, [home, editing]);

  // Update edit field.
  const updateField = useCallback(
    (field: keyof Omit<EditState, 'medicationId'>, value: string) => {
      setEditing((prev) => (prev ? { ...prev, [field]: value } : null));
    },
    [],
  );

  // Requirement 9.3: zero profiles → empty-medication-list message, no rows.
  if (polyView.layout === 'flat' && polyView.medications.length === 0) {
    return (
      <View style={styles.container} testID="medications-screen">
        <View style={styles.headerRow}>
          {onBack && (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" testID="medications-back">
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          )}
          <Text style={styles.title}>Cabinet</Text>
        </View>
        <Text style={styles.emptyMessage} testID="medications-empty-message">
          No medications found. Add a medication to get started.
        </Text>
        {onAdd && (
          <Pressable onPress={onAdd} accessibilityRole="button" testID="medications-add-empty">
            <Text style={styles.linkText}>Add medication</Text>
          </Pressable>
        )}
        {onNavigatePrn && (
          <Pressable onPress={onNavigatePrn} accessibilityRole="button" testID="medications-nav-prn">
            <Text style={styles.linkText}>PRN Quick Log</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="medications-screen">
      <View style={styles.headerRow}>
        {onBack && (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" testID="medications-back">
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
        )}
        <Text style={styles.title}>Cabinet</Text>
        {onAdd && (
          <Pressable onPress={onAdd} accessibilityRole="button" testID="medications-add">
            <Text style={styles.linkText}>Add</Text>
          </Pressable>
        )}
        {onNavigatePrn && (
          <Pressable onPress={onNavigatePrn} accessibilityRole="button" testID="medications-nav-prn">
            <Text style={styles.linkText}>PRN Quick Log</Text>
          </Pressable>
        )}
      </View>

      {/* Commit failure message (Requirement 9.7) */}
      {commitError && (
        <Text style={styles.errorText} accessibilityRole="alert" testID="medications-commit-error">
          {commitError}
        </Text>
      )}

      {/* Render the adaptive view blocks in exact order (Requirements 9.1, 9.2) */}
      {polyView.layout === 'flat' ? (
        <FlatMedicationList
          medications={polyView.medications}
          editing={editing}
          onEdit={handleEdit}
          onEditMedication={onEditMedication}
          onSave={handleSave}
          onCancel={handleCancelEdit}
          onUpdateField={updateField}
        />
      ) : (
        <GroupedMedicationView
          blocks={polyView.blocks}
          asNeeded={polyView.asNeeded}
          editing={editing}
          onEdit={handleEdit}
          onEditMedication={onEditMedication}
          onSave={handleSave}
          onCancel={handleCancelEdit}
          onUpdateField={updateField}
        />
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: flat list
// ---------------------------------------------------------------------------

interface ListProps {
  medications: MedicationProfile[];
  editing: EditState | null;
  onEdit: (med: MedicationProfile) => void;
  onEditMedication?: (medicationId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateField: (field: keyof Omit<EditState, 'medicationId'>, value: string) => void;
}

function FlatMedicationList({ medications, editing, onEdit, onEditMedication, onSave, onCancel, onUpdateField }: ListProps): React.ReactElement {
  return (
    <View testID="medications-flat-list">
      {medications.map((med) => (
        <MedicationRow
          key={med.id}
          medication={med}
          editing={editing}
          onEdit={onEdit}
          onEditMedication={onEditMedication}
          onSave={onSave}
          onCancel={onCancel}
          onUpdateField={onUpdateField}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: grouped view
// ---------------------------------------------------------------------------

interface GroupedProps {
  blocks: PolyViewBlock[];
  asNeeded: MedicationProfile[];
  editing: EditState | null;
  onEdit: (med: MedicationProfile) => void;
  onEditMedication?: (medicationId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateField: (field: keyof Omit<EditState, 'medicationId'>, value: string) => void;
}

function GroupedMedicationView({ blocks, asNeeded, editing, onEdit, onEditMedication, onSave, onCancel, onUpdateField }: GroupedProps): React.ReactElement {
  return (
    <View testID="medications-grouped-view">
      {/* Render blocks in the exact order returned by buildPolypharmacyView (Requirement 9.2) */}
      {blocks.map((block) => (
        <View key={block.block} testID={`medications-block-${block.block}`}>
          <Text style={styles.blockHeader}>{block.block}</Text>
          {block.medications.map((med) => (
            <MedicationRow
              key={med.id}
              medication={med}
              editing={editing}
              onEdit={onEdit}
              onEditMedication={onEditMedication}
              onSave={onSave}
              onCancel={onCancel}
              onUpdateField={onUpdateField}
            />
          ))}
        </View>
      ))}
      {/* As Needed section, positioned after blocks (Requirement 9.2) */}
      {asNeeded.length > 0 && (
        <View testID="medications-block-as-needed">
          <Text style={styles.blockHeader}>As Needed</Text>
          {asNeeded.map((med) => (
            <MedicationRow
              key={med.id}
              medication={med}
              editing={editing}
              onEdit={onEdit}
              onEditMedication={onEditMedication}
              onSave={onSave}
              onCancel={onCancel}
              onUpdateField={onUpdateField}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Medication row (display or edit mode)
// ---------------------------------------------------------------------------

interface MedicationRowProps {
  medication: MedicationProfile;
  editing: EditState | null;
  onEdit: (med: MedicationProfile) => void;
  onEditMedication?: (medicationId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateField: (field: keyof Omit<EditState, 'medicationId'>, value: string) => void;
}

function MedicationRow({ medication, editing, onEdit, onEditMedication, onSave, onCancel, onUpdateField }: MedicationRowProps): React.ReactElement {
  const isEditing = editing?.medicationId === medication.id;

  if (isEditing && editing) {
    return (
      <View style={styles.medicationRow} testID={`medication-row-${medication.id}`}>
        <TextInput
          style={styles.editInput}
          value={editing.drugName}
          onChangeText={(v: string) => onUpdateField('drugName', v)}
          placeholder="Drug name"
          accessibilityLabel="Drug name"
          testID={`edit-drugName-${medication.id}`}
        />
        <TextInput
          style={styles.editInput}
          value={editing.prescribingPhysician}
          onChangeText={(v: string) => onUpdateField('prescribingPhysician', v)}
          placeholder="Prescribing physician"
          accessibilityLabel="Prescribing physician"
          testID={`edit-prescribingPhysician-${medication.id}`}
        />
        <TextInput
          style={styles.editInput}
          value={editing.conditionTreated}
          onChangeText={(v: string) => onUpdateField('conditionTreated', v)}
          placeholder="Condition treated"
          accessibilityLabel="Condition treated"
          testID={`edit-conditionTreated-${medication.id}`}
        />
        <View style={styles.editActions}>
          <Pressable onPress={onSave} accessibilityRole="button" testID={`save-${medication.id}`}>
            <Text style={styles.saveText}>Save</Text>
          </Pressable>
          <Pressable onPress={onCancel} accessibilityRole="button" testID={`cancel-${medication.id}`}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const primaryRegimen = medication.regimens[0];

  return (
    <View style={styles.medicationRow} testID={`medication-row-${medication.id}`}>
      <MedProductIcon
        appearance={medication.appearance}
        form={primaryRegimen?.form ?? ''}
        dosageUnit={primaryRegimen ? parseDosageString(primaryRegimen.dosage).unit : ''}
        size={28}
      />
      <View style={styles.medInfo}>
        <Text style={styles.drugName} testID={`med-name-${medication.id}`}>
          {medication.drugName}
        </Text>
        <Text style={styles.dosageText}>
          {summarizeMedicationDosage(medication)} — {summarizeMedicationForm(medication)}
        </Text>
        <Text style={styles.detailText}>
          {medication.prescribingPhysician} • {medication.conditionTreated}
        </Text>
        {medication.refill?.quantityOnHand !== undefined && (
          <Text style={styles.refillText} testID={`med-refill-${medication.id}`}>
            Qty on hand: {medication.refill.quantityOnHand}
          </Text>
        )}
      </View>
      <View style={styles.rowActions}>
        {onEditMedication && (
          <Pressable
            onPress={() => onEditMedication(medication.id)}
            accessibilityRole="button"
            testID={`full-edit-${medication.id}`}
          >
            <Text style={styles.editBtnText}>Schedule</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => onEdit(medication)}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${medication.drugName}`}
          testID={`edit-btn-${medication.id}`}
        >
          <Text style={styles.editBtnText}>Quick edit</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    flex: 1,
  },
  backText: {
    fontSize: 16,
    color: '#0066cc',
  },
  linkText: {
    fontSize: 14,
    color: '#0066cc',
    fontWeight: '500',
  },
  emptyMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 48,
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  blockHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  medicationRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  medInfo: {
    flex: 1,
  },
  rowActions: {
    gap: 8,
    alignItems: 'flex-end',
  },
  drugName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dosageText: {
    fontSize: 14,
    color: '#555',
    marginTop: 2,
  },
  detailText: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  refillText: {
    fontSize: 12,
    color: '#8a5a00',
    marginTop: 4,
  },
  editBtnText: {
    fontSize: 14,
    color: '#0066cc',
    fontWeight: '500',
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
    fontSize: 14,
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  saveText: {
    fontSize: 14,
    color: '#0066cc',
    fontWeight: '600',
  },
  cancelText: {
    fontSize: 14,
    color: '#666',
  },
});
