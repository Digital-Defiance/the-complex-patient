/**
 * Human-readable clinical export summary (Markdown).
 *
 * Companion to the FHIR JSON bundle — intended for clinicians and visit prep.
 */

import type {
  Condition,
  FlareUp,
  MedicationProfile,
  PrnLog,
  SymptomEntry,
} from '@complex-patient/domain';
import { summarizeMedicationDosage, summarizeMedicationForm } from '@complex-patient/domain';
import { formatMedicationExportLabel, formatMedicationRxAnnotation } from '@complex-patient/drug-naming';
import type { ClinicalExportSource } from './types';
import { filterActive } from './partition';
import { EXPORT_JSON_FILENAME } from './types';

/** Severity ≥ this value is labeled "severe" in the summary (matches physician report). */
export const SEVERE_SYMPTOM_THRESHOLD = 7;

function mdCell(value: string): string {
  const trimmed = value.trim().replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return trimmed.length > 0 ? trimmed : '—';
}

function formatWhen(isoTimestamp: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) {
    return isoTimestamp;
  }
  return `${new Date(parsed).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`;
}

function formatDayHeading(day: string): string {
  const parsed = Date.parse(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed)) {
    return day;
  }
  return new Date(parsed).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDuration(symptom: SymptomEntry): string {
  const { value, unit } = symptom.duration;
  const label = value === 1 ? unit.replace(/s$/, '') : unit;
  return `${value} ${label}`;
}

function medicationLine(med: MedicationProfile): string {
  const label = formatMedicationExportLabel(med);
  const base = `**${mdCell(label)}** — ${mdCell(summarizeMedicationDosage(med))}, ${mdCell(summarizeMedicationForm(med))}`;
  const extras: string[] = [];
  const rxNote = formatMedicationRxAnnotation(med);
  if (rxNote) {
    extras.push(rxNote);
  }
  if (med.notes?.trim()) {
    extras.push(mdCell(med.notes.trim()));
  }
  if (med.conditionTreated.trim()) {
    extras.push(`for ${mdCell(med.conditionTreated)}`);
  }
  if (med.prescribingPhysician.trim()) {
    extras.push(`prescriber: ${mdCell(med.prescribingPhysician)}`);
  }
  return extras.length > 0 ? `${base} (${extras.join('; ')})` : base;
}

type TimelineItem =
  | { kind: 'symptom'; op_timestamp: string; symptom: SymptomEntry }
  | { kind: 'flare'; op_timestamp: string; flare: FlareUp; symptomLabels: string[] };

function buildTimeline(
  symptoms: readonly SymptomEntry[],
  flares: readonly FlareUp[],
): TimelineItem[] {
  const symptomById = new Map(symptoms.map((entry) => [entry.id, entry]));
  const items: TimelineItem[] = [];

  for (const symptom of symptoms) {
    items.push({ kind: 'symptom', op_timestamp: symptom.op_timestamp, symptom });
  }

  for (const flare of flares) {
    items.push({
      kind: 'flare',
      op_timestamp: flare.op_timestamp,
      flare,
      symptomLabels: flare.symptomIds.map(
        (id) => symptomById.get(id)?.symptomType ?? id,
      ),
    });
  }

  items.sort((left, right) => {
    if (left.op_timestamp !== right.op_timestamp) {
      return right.op_timestamp.localeCompare(left.op_timestamp);
    }
    return right.kind.localeCompare(left.kind);
  });

  return items;
}

function groupTimelineByDay(items: readonly TimelineItem[]): Map<string, TimelineItem[]> {
  const byDay = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const day = item.op_timestamp.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }
  return byDay;
}

function renderSymptomSection(symptom: SymptomEntry): string[] {
  const severe =
    symptom.severity >= SEVERE_SYMPTOM_THRESHOLD ? ' *(severe)*' : '';
  const lines = [
    `#### ${mdCell(symptom.symptomType)} — ${formatWhen(symptom.op_timestamp)}${severe}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Location | ${mdCell(symptom.systemicLocation)} |`,
    `| Severity | ${symptom.severity} / 10 |`,
    `| Duration | ${mdCell(formatDuration(symptom))} |`,
    `| Notes | ${mdCell(symptom.notes)} |`,
    '',
  ];
  return lines;
}

function renderFlareSection(flare: FlareUp, symptomLabels: string[]): string[] {
  const labels = symptomLabels.map((label) => mdCell(label)).join(', ');
  return [
    `#### Flare-up — ${formatWhen(flare.op_timestamp)}`,
    '',
    `- **Symptoms involved:** ${labels || '—'}`,
    `- **Trigger (patient-reported):** ${mdCell(flare.trigger)}`,
    '',
  ];
}

/**
 * Build a Markdown clinical summary for visit prep and clinician review.
 */
export function buildClinicalSummaryMarkdown(
  source: ClinicalExportSource,
  exportedAt = new Date().toISOString(),
): string {
  const medications = filterActive(source.medications);
  const prnLogs = filterActive(source.prnLogs);
  const symptoms = filterActive(source.symptoms);
  const conditions = filterActive(source.conditions);
  const flares = filterActive(source.flares);

  const medicationNames = new Map(medications.map((med) => [med.id, med.drugName]));
  const activeMeds = medications.filter((med) => med.active);
  const severeSymptoms = symptoms.filter((s) => s.severity >= SEVERE_SYMPTOM_THRESHOLD);
  const timeline = buildTimeline(symptoms, flares);
  const byDay = groupTimelineByDay(timeline);
  const sortedDays = [...byDay.keys()].sort((a, b) => b.localeCompare(a));

  const lines: string[] = [
    '# Clinical Summary',
    '',
    '> Patient-reported data exported from Complex Patient. Identifying demographics are not included.',
    `> **Exported:** ${formatWhen(exportedAt)}`,
    `> **Structured data:** \`${EXPORT_JSON_FILENAME}\` (FHIR R4 bundle for import and archival)`,
    '',
    '## At a glance',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Active conditions | ${conditions.length} |`,
    `| Active medications | ${activeMeds.length} |`,
    `| Symptom entries | ${symptoms.length} |`,
    `| Flare-ups | ${flares.length} |`,
    `| PRN medication logs | ${prnLogs.length} |`,
    `| Severe symptoms (${SEVERE_SYMPTOM_THRESHOLD}–10/10) | ${severeSymptoms.length} |`,
    '',
    '## Conditions',
    '',
  ];

  if (conditions.length === 0) {
    lines.push('_No conditions recorded._', '');
  } else {
    for (const condition of conditions) {
      lines.push(`- ${mdCell(condition.name)}`);
    }
    lines.push('');
  }

  lines.push('## Active medications', '');

  if (activeMeds.length === 0) {
    lines.push('_No active medications recorded._', '');
  } else {
    for (const med of activeMeds) {
      lines.push(`- ${medicationLine(med)}`);
    }
    lines.push('');
  }

  lines.push('## Symptom & flare journal', '', '_Newest first._', '');

  if (timeline.length === 0) {
    lines.push('_No symptoms or flare-ups recorded._', '');
  } else {
    for (const day of sortedDays) {
      lines.push(`### ${formatDayHeading(day)}`, '');
      const dayItems = byDay.get(day) ?? [];
      for (const item of dayItems) {
        if (item.kind === 'symptom') {
          lines.push(...renderSymptomSection(item.symptom));
        } else {
          lines.push(...renderFlareSection(item.flare, item.symptomLabels));
        }
      }
    }
  }

  lines.push('## PRN medication log', '');

  if (prnLogs.length === 0) {
    lines.push('_No PRN logs recorded._', '');
  } else {
    const sortedLogs = [...prnLogs].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    lines.push(
      '| When | Medication | Amount |',
      '| --- | --- | ---: |',
    );
    for (const log of sortedLogs) {
      const name = medicationNames.get(log.medicationId) ?? log.medicationId;
      lines.push(
        `| ${formatWhen(log.takenAt)} | ${mdCell(name)} | ${log.amount} |`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## For your clinician',
    '',
    'This summary is meant to be read before or during an appointment. Severity, duration, and triggers are patient-reported. The bundled FHIR JSON preserves full structured data for re-import into Complex Patient.',
    '',
    '---',
    '',
    '_Generated on-device. Complex Patient does not transmit this export to any server._',
    '',
  );

  return lines.join('\n');
}
