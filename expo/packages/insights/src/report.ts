/**
 * @complex-patient/insights — On-device Physician_Report compilation
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6
 *
 * This module compiles a {@link PhysicianReport} and renders it to a PDF
 * **entirely on-device**. Like the variance pipeline (13.1) and correlation
 * detection (13.2), compilation is a **pure, in-memory computation**:
 *
 * - It reads already-decrypted data from an injected {@link ReportDataSource}
 *   and an injected {@link Clock}; it performs NO network I/O and never touches
 *   any HTTP client, `fetch`, header, or query parameter (19.1, 19.2 carried
 *   forward; reinforced by 21.2, 21.3 — no server-side processing).
 * - It compiles three sections:
 *     1. the active polypharmacy list (medications marked active at request
 *        time) (21.1),
 *     2. the trailing-90-day severe-symptom frequency — the count of symptom
 *        occurrences whose severity meets or exceeds the severe threshold
 *        within the last 90 calendar days (21.4), and
 *     3. the AI-identified correlation cards (reusing {@link detectCorrelations}).
 * - Each section is marked explicitly empty when it has no data, so the
 *   rendered PDF can state "No data available." per section (21.5).
 * - It never mutates the data source. On any failure — including a renderer
 *   throwing — it returns an error result and transmits/persists nothing,
 *   leaving the vault unchanged (21.6).
 *
 * The PDF byte generation is delegated to an injected {@link PhysicianReportRenderer}
 * so the compilation logic is testable without a real PDF engine in the test
 * environment, and so the concrete renderer can be the platform's on-device PDF
 * library at the call site.
 */

import type { MedicationProfile, SymptomEntry, PrnLog } from '@complex-patient/domain';
import { summarizeMedicationDosage, summarizeMedicationForm } from '@complex-patient/domain';
import { formatMedicationExportLabel, formatMedicationRxAnnotation } from '@complex-patient/drug-naming';
import { systemClock } from './pipeline';
import { detectCorrelations, type AIInsightCard } from './correlation';
import type { Clock, MedEvent, VaultDataSource } from './types';

/** Milliseconds in one calendar day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Trailing window, in calendar days, over which severe symptoms are counted
 * for the Physician_Report (21.4). Distinct from the 30-day analytics window.
 */
export const REPORT_WINDOW_DAYS = 90;

/**
 * The "severe" threshold on the 1–10 symptom severity scale (15.4). A symptom
 * occurrence counts toward the severe-symptom frequency when its user-recorded
 * severity is **greater than or equal to** this value (21.4).
 *
 * The requirements call this "the severe level on the symptom severity scale"
 * without fixing a number; on a 1–10 scale the upper third (7–10) is the
 * conventional "severe" band, so this is documented as 7.
 */
export const SEVERE_SYMPTOM_THRESHOLD = 7;

/** Generation time budget, in milliseconds (21.1: within 10 seconds). */
export const REPORT_TIME_BUDGET_MS = 10_000;

/** Per-section marker shown when a report section has no data (21.5). */
export const NO_DATA_AVAILABLE_MESSAGE = 'No data available.';

/** User-facing message shown when report generation fails (21.6). */
export const REPORT_FAILED_MESSAGE =
  'Report generation failed. Your data has not been changed.';

/** Stable section titles for the compiled report. */
export const REPORT_SECTION_TITLES = {
  medications: 'Active Medications',
  severeSymptoms: 'Severe Symptom Frequency (last 90 days)',
  correlations: 'AI-Identified Correlations',
} as const;

/**
 * A read-only, in-memory view providing everything the Physician_Report needs.
 *
 * Extends the analytics {@link VaultDataSource} (so it can be passed straight to
 * {@link detectCorrelations}) with access to medication profiles for the active
 * polypharmacy list (21.1).
 */
export interface ReportDataSource extends VaultDataSource {
  getMedications(): readonly MedicationProfile[];
}

/**
 * Construct a read-only {@link ReportDataSource} over in-memory arrays.
 *
 * Defensive copies are taken at construction time so later mutations of the
 * caller's arrays cannot retroactively change report inputs, and the returned
 * accessors hand back stable, frozen snapshots. This is the seam through which
 * the UI passes the decrypted Local_Vault partitions into report compilation
 * without the report ever touching storage or the network (21.2, 21.3).
 */
export function createInMemoryReportDataSource(input: {
  medications?: readonly MedicationProfile[];
  symptoms?: readonly SymptomEntry[];
  prnLogs?: readonly PrnLog[];
  medEvents?: readonly MedEvent[];
}): ReportDataSource {
  const medications = Object.freeze([...(input.medications ?? [])]);
  const symptoms = Object.freeze([...(input.symptoms ?? [])]);
  const prnLogs = Object.freeze([...(input.prnLogs ?? [])]);
  const medEvents = Object.freeze([...(input.medEvents ?? [])]);

  return {
    getMedications: () => medications,
    getSymptoms: () => symptoms,
    getPrnLogs: () => prnLogs,
    getMedEvents: () => medEvents,
  };
}

/**
 * One rendered section of the report. When `empty` is true the section had no
 * data and `lines` is exactly `[NO_DATA_AVAILABLE_MESSAGE]` (21.5).
 */
export interface PhysicianReportSection {
  title: string;
  empty: boolean;
  lines: string[];
}

/**
 * The compiled, on-device Physician_Report data model (design "Insights
 * Domain"). It is a plain, network-free object; rendering it to PDF bytes is a
 * separate, injected step.
 */
export interface PhysicianReport {
  /** ISO 8601 timestamp the report was generated at (device clock). */
  generatedAt: string;
  /** Medications marked active at request time, ordered by drug name (21.1). */
  activePolypharmacy: MedicationProfile[];
  /** Count of severe symptom occurrences over the trailing 90 days (21.4). */
  severeSymptomFrequency90d: number;
  /** The severity threshold used for the severe-symptom count (21.4). */
  severeSymptomThreshold: number;
  /** The trailing window size, in days, for the severe-symptom count (21.4). */
  windowDays: number;
  /** AI-identified correlation cards (empty when none significant) (21.1). */
  correlations: AIInsightCard[];
  /** Explicitly-marked sections, including empty-section markers (21.5). */
  sections: PhysicianReportSection[];
}

/**
 * Injected on-device PDF renderer. The concrete implementation at the call site
 * uses the platform's PDF library; tests inject a trivial renderer. Must run
 * fully on-device (21.2, 21.3) and must not perform network I/O.
 */
export interface PhysicianReportRenderer<T = Uint8Array> {
  render(report: PhysicianReport): T;
}

/** Discriminated result of compiling the report data model. */
export type PhysicianReportBuildResult =
  | { status: 'ok'; report: PhysicianReport; durationMs: number }
  | { status: 'error'; message: string };

/** Discriminated result of generating (compiling + rendering) the report. */
export type PhysicianReportResult<T = Uint8Array> =
  | { status: 'ok'; report: PhysicianReport; document: T; durationMs: number }
  | { status: 'error'; message: string };

/** Inclusive lower bound of the trailing 90-day window: `now - 90 days`. */
function windowStart(now: Date): number {
  return now.getTime() - REPORT_WINDOW_DAYS * MS_PER_DAY;
}

/**
 * Whether an ISO 8601 timestamp falls within `[now - 90d, now]`. Unparseable
 * timestamps are excluded so malformed data cannot widen the count.
 */
function isInWindow(iso: string, startMs: number, nowMs: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= startMs && t <= nowMs;
}

/** Count trailing-90-day symptom occurrences at or above the severe threshold (21.4). */
function countSevereSymptoms(
  symptoms: readonly SymptomEntry[],
  startMs: number,
  nowMs: number,
): number {
  let count = 0;
  for (const entry of symptoms) {
    if (
      entry.severity >= SEVERE_SYMPTOM_THRESHOLD &&
      isInWindow(entry.op_timestamp, startMs, nowMs)
    ) {
      count += 1;
    }
  }
  return count;
}

/** Alphabetical-by-drug-name ordering for a deterministic active-meds list. */
function compareMedications(a: MedicationProfile, b: MedicationProfile): number {
  if (a.drugName !== b.drugName) return a.drugName < b.drugName ? -1 : 1;
  // Stable tiebreak on id so equal names produce a deterministic order.
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Render a single medication into a human-readable line. */
function medicationLine(med: MedicationProfile): string {
  const label = formatMedicationExportLabel(med);
  const base = `${label} — ${summarizeMedicationDosage(med)}, ${summarizeMedicationForm(med)}`;
  const extras: string[] = [];
  const rxNote = formatMedicationRxAnnotation(med);
  if (rxNote) {
    extras.push(rxNote);
  }
  if (med.conditionTreated.trim()) {
    extras.push(med.conditionTreated.trim());
  }
  if (med.prescribingPhysician.trim()) {
    extras.push(med.prescribingPhysician.trim());
  }
  if (extras.length === 0) {
    return base;
  }
  return `${base} (${extras.join('; ')})`;
}

/** Render a single correlation card into a human-readable line (20.2). */
function correlationLine(card: AIInsightCard): string {
  const [a, b] = card.variables;
  const lag =
    card.lagDays === 0
      ? 'same day'
      : `${card.lagDays} day${card.lagDays === 1 ? '' : 's'} later`;
  return `${a} is ${card.direction}ly correlated with ${b} (${lag}).`;
}

/** Build a section, substituting the explicit empty marker when needed (21.5). */
function buildSection(title: string, lines: string[]): PhysicianReportSection {
  if (lines.length === 0) {
    return { title, empty: true, lines: [NO_DATA_AVAILABLE_MESSAGE] };
  }
  return { title, empty: false, lines };
}

/**
 * Compile the {@link PhysicianReport} data model entirely on-device (21.1, 21.4,
 * 21.5). Pure and side-effect free: the source is only read, never mutated, so
 * the vault is retained unchanged (21.6). Performs NO network I/O (21.2, 21.3).
 *
 * @param source Injected, already-decrypted in-memory vault view. Never mutated.
 * @param clock  Injected clock anchoring the trailing-90-day window.
 * @returns A single {@link PhysicianReportBuildResult}.
 */
export function buildPhysicianReport(
  source: ReportDataSource,
  clock: Clock = systemClock,
): PhysicianReportBuildResult {
  try {
    const now = clock.now();
    const nowMs = now.getTime();
    if (Number.isNaN(nowMs)) {
      throw new TypeError('clock returned an invalid date');
    }
    const startMs = windowStart(now);
    const startedAt = Date.now();

    // Section 1: active polypharmacy at request time (21.1).
    const activePolypharmacy = source
      .getMedications()
      .filter((m) => m.active)
      .slice()
      .sort(compareMedications);

    // Section 2: trailing-90-day severe-symptom frequency (21.4).
    const severeSymptomFrequency90d = countSevereSymptoms(
      source.getSymptoms(),
      startMs,
      nowMs,
    );

    // Section 3: AI-identified correlation cards, reusing the 30-day detector.
    // A detector error is an internal failure and aborts the whole report (21.6).
    const correlationOutcome = detectCorrelations(source, clock);
    if (correlationOutcome.status === 'error') {
      return { status: 'error', message: REPORT_FAILED_MESSAGE };
    }
    const correlations: AIInsightCard[] =
      correlationOutcome.status === 'ok' ? correlationOutcome.cards : [];

    const sections: PhysicianReportSection[] = [
      buildSection(
        REPORT_SECTION_TITLES.medications,
        activePolypharmacy.map(medicationLine),
      ),
      buildSection(
        REPORT_SECTION_TITLES.severeSymptoms,
        severeSymptomFrequency90d === 0
          ? []
          : [
              `${severeSymptomFrequency90d} severe symptom occurrence${
                severeSymptomFrequency90d === 1 ? '' : 's'
              } (severity ≥ ${SEVERE_SYMPTOM_THRESHOLD}) in the last ${REPORT_WINDOW_DAYS} days.`,
            ],
      ),
      buildSection(REPORT_SECTION_TITLES.correlations, correlations.map(correlationLine)),
    ];

    const report: PhysicianReport = {
      generatedAt: now.toISOString(),
      activePolypharmacy,
      severeSymptomFrequency90d,
      severeSymptomThreshold: SEVERE_SYMPTOM_THRESHOLD,
      windowDays: REPORT_WINDOW_DAYS,
      correlations,
      sections,
    };

    return { status: 'ok', report, durationMs: Date.now() - startedAt };
  } catch {
    // On any failure: transmit/persist nothing, leave the vault unchanged
    // (the source is only ever read), and surface an error message (21.6).
    return { status: 'error', message: REPORT_FAILED_MESSAGE };
  }
}

/**
 * Compile and render the Physician_Report to a PDF document entirely on-device
 * (21.1–21.3, 21.5). On any failure, including the renderer throwing, returns
 * an error result leaving the vault unchanged (21.6).
 *
 * @param source   Injected, already-decrypted in-memory vault view. Never mutated.
 * @param renderer Injected on-device PDF renderer.
 * @param clock    Injected clock anchoring the trailing-90-day window.
 * @returns A single {@link PhysicianReportResult}. The `durationMs` covers both
 *          compilation and rendering and is expected to be well under
 *          {@link REPORT_TIME_BUDGET_MS} (21.1).
 */
export function generatePhysicianReport<T = Uint8Array>(
  source: ReportDataSource,
  renderer: PhysicianReportRenderer<T>,
  clock: Clock = systemClock,
): PhysicianReportResult<T> {
  const startedAt = Date.now();
  const built = buildPhysicianReport(source, clock);
  if (built.status === 'error') {
    return { status: 'error', message: built.message };
  }

  try {
    const document = renderer.render(built.report);
    return {
      status: 'ok',
      report: built.report,
      document,
      durationMs: Date.now() - startedAt,
    };
  } catch {
    // Rendering failed: nothing has been persisted or transmitted and the
    // source was only read, so the vault is unchanged (21.6).
    return { status: 'error', message: REPORT_FAILED_MESSAGE };
  }
}
