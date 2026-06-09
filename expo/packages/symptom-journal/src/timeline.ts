/**
 * @complex-patient/symptom-journal — Condition timeline projection
 *
 * Implements the per-condition timeline view for the Symptom_Journal subsystem
 * as a pure projection function over decrypted records (Requirement 18):
 * - filter to only the symptoms, medications, and flare-ups tagged to the
 *   condition, excluding every entry not tagged to it (18.1);
 * - order the resulting entries by their client-side operational timestamps
 *   in descending order, most recent first (18.2);
 * - break ties on equal `op_timestamp` using the lexicographically greater
 *   unique record id so the order is total and deterministic (18.3) — the same
 *   tie-break direction used by the Sync_Engine three-way merge;
 * - signal the empty-state when nothing is tagged to the condition (18.4),
 *   otherwise return the populated timeline with the empty-state cleared (18.5).
 *
 * "Tagged to the condition" is derived purely from the `associations` partition
 * (`symptomId → conditionIds[] / medicationIds[]`):
 * - a symptom is tagged when an Association links it to the condition;
 * - a medication is tagged when it is reachable through an Association that also
 *   references the condition (e.g. a suspected adverse reaction logged against a
 *   symptom of that condition);
 * - a flare-up is tagged when it references at least one symptom tagged to the
 *   condition.
 *
 * The function performs no I/O and no mutation, so it is trivially unit- and
 * property-testable and safe to run inside the privacy sandbox.
 */

import type {
  Association,
  Condition,
  FlareUp,
  MedicationProfile,
  SymptomEntry,
} from '@complex-patient/domain';

/** Discriminates the kind of record a {@link TimelineEntry} projects. */
export type TimelineEntryKind = 'symptom' | 'medication' | 'flare';

/**
 * A single chronological entry in a condition timeline. `id` and `op_timestamp`
 * are lifted from the underlying {@link VaultRecord} so the ordering (18.2,
 * 18.3) can be computed without re-narrowing the union, while `record` carries
 * the full decrypted entry for rendering.
 */
export interface TimelineEntry {
  kind: TimelineEntryKind;
  id: string;
  op_timestamp: string;
  record: SymptomEntry | MedicationProfile | FlareUp;
}

/**
 * The result of {@link buildConditionTimeline}.
 *
 * - `entries` is the ordered, tagged-only timeline (18.1, 18.2, 18.3).
 * - `isEmpty` is the empty-state signal: `true` when nothing is tagged to the
 *   condition so the caller shows the empty-state message in place of the
 *   timeline (18.4); `false` while at least one entry is tagged, in which case
 *   the timeline is shown and the empty-state message is suppressed (18.5).
 */
export interface ConditionTimeline {
  conditionId: string;
  entries: TimelineEntry[];
  isEmpty: boolean;
}

/**
 * Order two timeline entries by `op_timestamp` descending (most recent first,
 * 18.2), breaking ties with the lexicographically greater id first (18.3). ISO
 * 8601 timestamps are lexicographically comparable, matching the Sync_Engine
 * tie-break direction so ordering stays consistent across the platform.
 */
function compareTimelineEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.op_timestamp !== b.op_timestamp) {
    return a.op_timestamp > b.op_timestamp ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id > b.id ? -1 : 1;
  }
  return 0;
}

/**
 * Project the per-condition timeline (Requirement 18).
 *
 * Filters `symptoms`, `meds`, and `flares` down to only the entries tagged to
 * `conditionId` via the `associations` set, returns them ordered most-recent
 * first with a deterministic id tie-break, and reports whether the result is
 * empty so the caller can switch between the timeline and the empty-state
 * message (18.4, 18.5).
 *
 * The function is a total, deterministic pure function of its inputs: identical
 * inputs always produce an identical {@link ConditionTimeline}.
 */
export function buildConditionTimeline(
  conditionId: string,
  symptoms: readonly SymptomEntry[],
  meds: readonly MedicationProfile[],
  flares: readonly FlareUp[],
  assoc: readonly Association[],
): ConditionTimeline {
  // Associations that reference this condition define what is tagged to it.
  const associationsForCondition = assoc.filter((a) => a.conditionIds.includes(conditionId));

  const taggedSymptomIds = new Set<string>();
  const taggedMedicationIds = new Set<string>();
  for (const a of associationsForCondition) {
    taggedSymptomIds.add(a.symptomId);
    for (const medicationId of a.medicationIds) {
      taggedMedicationIds.add(medicationId);
    }
  }

  const entries: TimelineEntry[] = [];

  // Symptoms tagged directly to the condition (18.1).
  for (const symptom of symptoms) {
    if (taggedSymptomIds.has(symptom.id)) {
      entries.push({
        kind: 'symptom',
        id: symptom.id,
        op_timestamp: symptom.op_timestamp,
        record: symptom,
      });
    }
  }

  // Medications reachable through an association referencing the condition (18.1).
  for (const med of meds) {
    if (taggedMedicationIds.has(med.id)) {
      entries.push({
        kind: 'medication',
        id: med.id,
        op_timestamp: med.op_timestamp,
        record: med,
      });
    }
  }

  // Flare-ups that group at least one symptom tagged to the condition (18.1).
  for (const flare of flares) {
    if (flare.symptomIds.some((symptomId) => taggedSymptomIds.has(symptomId))) {
      entries.push({
        kind: 'flare',
        id: flare.id,
        op_timestamp: flare.op_timestamp,
        record: flare,
      });
    }
  }

  // Order by op_timestamp DESC with lexicographic-id tie-break (18.2, 18.3).
  entries.sort(compareTimelineEntries);

  return {
    conditionId,
    entries,
    // Empty-state when nothing is tagged (18.4); otherwise show timeline (18.5).
    isEmpty: entries.length === 0,
  };
}

export type { Condition };
