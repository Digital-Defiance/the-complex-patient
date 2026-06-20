/**
 * Shared symptom journal UI helpers — matching and autocomplete.
 */

import type { FlareUp, SymptomEntry, TimeUnit } from '@complex-patient/domain';

export const DURATION_UNITS: readonly TimeUnit[] = ['minutes', 'hours', 'days', 'weeks'];

export function normalizeSymptomLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function symptomTypeKey(value: string): string {
  return normalizeSymptomLabel(value).toLowerCase();
}

/** Return the canonical symptom type label when `typed` matches an existing entry. */
export function resolveSymptomTypeMatch(existing: readonly SymptomEntry[], typed: string): string | null {
  const key = symptomTypeKey(typed);
  if (!key) return null;
  const match = existing.find((entry) => symptomTypeKey(entry.symptomType) === key);
  return match ? normalizeSymptomLabel(match.symptomType) : null;
}

export function suggestSymptomTypes(
  existing: readonly SymptomEntry[],
  query: string,
  limit = 8,
): string[] {
  const key = symptomTypeKey(query);
  const seen = new Set<string>();
  const results: string[] = [];

  for (const entry of existing) {
    const label = normalizeSymptomLabel(entry.symptomType);
    const labelKey = symptomTypeKey(label);
    if (!labelKey || seen.has(labelKey)) continue;
    if (!key || labelKey.includes(key)) {
      seen.add(labelKey);
      results.push(label);
      if (results.length >= limit) break;
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

export function suggestSystemicLocations(
  existing: readonly SymptomEntry[],
  symptomType: string,
  query: string,
  limit = 8,
): string[] {
  const typeKey = symptomTypeKey(symptomType);
  const locationKey = normalizeSymptomLabel(query).toLowerCase();
  const seen = new Set<string>();
  const results: string[] = [];

  for (const entry of existing) {
    if (typeKey && symptomTypeKey(entry.symptomType) !== typeKey) continue;
    const label = normalizeSymptomLabel(entry.systemicLocation);
    const labelKey = label.toLowerCase();
    if (!labelKey || seen.has(labelKey)) continue;
    if (!locationKey || labelKey.includes(locationKey)) {
      seen.add(labelKey);
      results.push(label);
      if (results.length >= limit) break;
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

export function normalizeDurationUnit(value: string): TimeUnit | null {
  const normalized = value.trim().toLowerCase();
  return DURATION_UNITS.find((unit) => unit === normalized) ?? null;
}

/** Merge journal writes onto the latest store snapshot (avoids stale read clobbering). */
export function mergeSymptomRecords(current: SymptomEntry[], next: SymptomEntry[]): SymptomEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of next) {
    byId.set(entry.id, entry);
  }

  const ordered: SymptomEntry[] = [];
  const seen = new Set<string>();

  for (const entry of current) {
    const merged = byId.get(entry.id);
    if (merged) {
      ordered.push(merged);
      seen.add(entry.id);
    }
  }

  for (const entry of next) {
    if (!seen.has(entry.id)) {
      ordered.push(entry);
      seen.add(entry.id);
    }
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Journal history timeline (symptoms + flares)
// ---------------------------------------------------------------------------

export type JournalHistoryEntry =
  | { kind: 'symptom'; id: string; op_timestamp: string; record: SymptomEntry }
  | { kind: 'flare'; id: string; op_timestamp: string; record: FlareUp; symptomLabels: string[] };

/** Merge symptoms and flare-ups into one reverse-chronological journal feed. */
export function buildJournalTimeline(
  symptoms: readonly SymptomEntry[],
  flares: readonly FlareUp[],
): JournalHistoryEntry[] {
  const symptomById = new Map(symptoms.map((entry) => [entry.id, entry]));
  const entries: JournalHistoryEntry[] = [];

  for (const symptom of symptoms) {
    entries.push({
      kind: 'symptom',
      id: symptom.id,
      op_timestamp: symptom.op_timestamp,
      record: symptom,
    });
  }

  for (const flare of flares) {
    entries.push({
      kind: 'flare',
      id: flare.id,
      op_timestamp: flare.op_timestamp,
      record: flare,
      symptomLabels: flare.symptomIds.map(
        (symptomId) => symptomById.get(symptomId)?.symptomType ?? symptomId,
      ),
    });
  }

  entries.sort((a, b) => {
    if (a.op_timestamp !== b.op_timestamp) {
      return b.op_timestamp.localeCompare(a.op_timestamp);
    }
    return b.id.localeCompare(a.id);
  });

  return entries;
}

export function calendarDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export interface JournalDayGroup {
  day: string;
  entries: JournalHistoryEntry[];
}

/** Group journal entries by UTC calendar day, newest day first. */
export function groupJournalByDay(entries: readonly JournalHistoryEntry[]): JournalDayGroup[] {
  const byDay = new Map<string, JournalHistoryEntry[]>();

  for (const entry of entries) {
    const day = calendarDayKey(entry.op_timestamp);
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, dayEntries]) => ({ day, entries: dayEntries }));
}

export interface SeverityTrendDay {
  day: string;
  maxSeverity: number | null;
  flareCount: number;
  symptomCount: number;
}

/**
 * Daily max symptom severity and flare counts for a trailing window.
 * Used for the simple bar chart on the journal history screen.
 */
export function buildSeverityTrend(
  entries: readonly JournalHistoryEntry[],
  dayCount = 14,
  referenceDate: Date = new Date(),
): SeverityTrendDay[] {
  const days: string[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(referenceDate);
    date.setUTCDate(date.getUTCDate() - offset);
    days.push(date.toISOString().slice(0, 10));
  }

  const byDay = new Map<string, SeverityTrendDay>();
  for (const day of days) {
    byDay.set(day, { day, maxSeverity: null, flareCount: 0, symptomCount: 0 });
  }

  for (const entry of entries) {
    const day = calendarDayKey(entry.op_timestamp);
    const bucket = byDay.get(day);
    if (!bucket) continue;

    if (entry.kind === 'symptom') {
      bucket.symptomCount += 1;
      bucket.maxSeverity =
        bucket.maxSeverity === null
          ? entry.record.severity
          : Math.max(bucket.maxSeverity, entry.record.severity);
    } else {
      bucket.flareCount += 1;
    }
  }

  return days.map((day) => byDay.get(day)!);
}

export function formatJournalDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
