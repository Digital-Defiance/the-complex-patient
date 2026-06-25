/**
 * @complex-patient/medications — Adaptive polypharmacy view (Requirement 14)
 *
 * A pure function that maps the active medication set to a display model:
 *
 * - WHILE the count of active daily medications is greater than 10, medications
 *   are grouped into time-of-day blocks in the fixed order
 *   [Morning, Midday, Evening, Night/Bedtime] (14.1), ordered alphabetically by
 *   medication name within each block (14.1), with a med that has multiple
 *   scheduled administration times placed into EACH corresponding block (14.3).
 *   Active medications with no scheduled administration time or designated
 *   as-needed are listed in a separate "As Needed" section positioned after
 *   Night/Bedtime (14.4), and any time-of-day block with zero medications is
 *   omitted (14.5).
 * - WHILE the count of active daily medications is 10 or fewer, medications are
 *   shown as a single flat list ordered alphabetically by medication name (14.2).
 *
 * Time-block assignment windows (14.3):
 *   - Morning        05:00–10:59
 *   - Midday         11:00–16:59
 *   - Evening        17:00–21:59
 *   - Night/Bedtime  22:00–04:59  (wraps across midnight)
 *
 * Interpretation of "active daily medications": the set of medications with
 * `active === true`. Requirement 14.4 itself refers to an as-needed medication
 * as "an active daily medication", so PRN / no-scheduled-time medications are
 * part of the counted set (driving the >10 boundary) and are routed to the
 * "As Needed" section rather than excluded from the count. Inactive medications
 * (`active === false`) are excluded entirely from the view.
 *
 * This function is pure and dependency-free so it is deterministic and
 * exhaustively testable under vitest (property test 11.6, unit tests 11.7).
 */

import { scheduledTimesForMedication, type MedicationProfile, type TimeBlock } from '@complex-patient/domain';

/** The >10 boundary: strictly greater than this count switches to grouped. */
const FLAT_LIST_MAX = 10;

/** Fixed presentation order of the time-of-day blocks (14.1). */
const BLOCK_ORDER: readonly TimeBlock[] = [
  'Morning',
  'Midday',
  'Evening',
  'Night/Bedtime',
] as const;

/** A single time-of-day block with its alphabetically ordered medications. */
export interface PolyViewBlock {
  /** The time-of-day block. */
  block: TimeBlock;
  /** Medications scheduled in this block, ordered alphabetically by name. */
  medications: MedicationProfile[];
}

/**
 * The adaptive display model produced by {@link buildPolypharmacyView}.
 *
 * - `flat`: a single alphabetical list of all active medications (≤10) (14.2).
 * - `grouped`: time-of-day blocks in fixed order with empty blocks omitted
 *   (14.1, 14.5), plus a trailing `asNeeded` section (14.4). When there are no
 *   as-needed medications, `asNeeded` is an empty array (the section is omitted
 *   by callers).
 */
export type PolyView =
  | { layout: 'flat'; medications: MedicationProfile[] }
  | { layout: 'grouped'; blocks: PolyViewBlock[]; asNeeded: MedicationProfile[] };

/**
 * Build the adaptive polypharmacy view from a set of medication profiles
 * (Requirements 14.1–14.5).
 *
 * Inactive medications are filtered out. The remaining active set drives the
 * >10/≤10 layout decision.
 */
export function buildPolypharmacyView(meds: readonly MedicationProfile[]): PolyView {
  const active = meds.filter((m) => m.active === true && m.deleted !== true);

  // ≤10 active → single alphabetical flat list (14.2).
  if (active.length <= FLAT_LIST_MAX) {
    return { layout: 'flat', medications: sortByName(active) };
  }

  // >10 active → grouped time-of-day blocks (14.1).
  const blockMembers = new Map<TimeBlock, MedicationProfile[]>();
  const asNeeded: MedicationProfile[] = [];

  for (const med of active) {
    const blocks = blocksForMedication(med);
    if (blocks.size === 0) {
      // No scheduled administration time or designated as-needed (14.4).
      asNeeded.push(med);
      continue;
    }
    // A med with multiple scheduled times appears in each matching block (14.3).
    for (const block of blocks) {
      const list = blockMembers.get(block);
      if (list === undefined) {
        blockMembers.set(block, [med]);
      } else {
        list.push(med);
      }
    }
  }

  // Emit blocks in fixed order, omitting empty ones (14.1, 14.5), each ordered
  // alphabetically by medication name (14.1).
  const blocks: PolyViewBlock[] = [];
  for (const block of BLOCK_ORDER) {
    const members = blockMembers.get(block);
    if (members === undefined || members.length === 0) continue;
    blocks.push({ block, medications: sortByName(members) });
  }

  // "As Needed" section positioned after Night/Bedtime, ordered alphabetically.
  return { layout: 'grouped', blocks, asNeeded: sortByName(asNeeded) };
}

/**
 * The set of time-of-day blocks a medication occupies based on its scheduled
 * administration times (14.3). Returns an empty set when the medication has no
 * scheduled administration time or is designated as-needed (14.4).
 */
function blocksForMedication(med: MedicationProfile): Set<TimeBlock> {
  const blocks = new Set<TimeBlock>();
  for (const time of scheduledTimesForMedication(med)) {
    const block = blockForTime(time);
    if (block !== null) blocks.add(block);
  }
  return blocks;
}

/**
 * Parse an "HH:mm" 24-hour time into minutes-since-midnight, or `null` if the
 * value is malformed or out of range.
 */
function parseMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

function blockForTime(time: string): TimeBlock | null {
  const minutes = parseMinutes(time);
  if (minutes === null) return null;
  if (minutes >= 300 && minutes <= 659) return 'Morning';
  if (minutes >= 660 && minutes <= 1019) return 'Midday';
  if (minutes >= 1020 && minutes <= 1319) return 'Evening';
  return 'Night/Bedtime';
}

/**
 * Order medications alphabetically by `drugName` (14.1, 14.2), with the unique
 * record `id` as a deterministic tiebreak for equal names. Returns a new array;
 * the input is not mutated.
 */
function sortByName(meds: readonly MedicationProfile[]): MedicationProfile[] {
  return [...meds].sort((a, b) => {
    const byName = a.drugName.localeCompare(b.drugName);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}
