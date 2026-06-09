import { describe, it, expect } from 'vitest';
import type { MedicationProfile, MedicationSchedule } from '@complex-patient/domain';
import { buildPolypharmacyView } from './index';

/**
 * Targeted unit tests for the adaptive polypharmacy view (Task 11.7;
 * validates 14.1–14.5).
 *
 * These complement the example coverage in `view.test.ts` (Task 11.5) without
 * duplicating it. The cases here exercise edges that file does not:
 *
 * - soft-`deleted` exclusion from the active count (14.1, 14.2)
 * - PRN / as-needed meds counting toward the >10 boundary and routed to the
 *   "As Needed" section (14.1, 14.4)
 * - malformed scheduled-time strings treated as no-scheduled-time → As Needed (14.4)
 * - multiple scheduled times in the SAME block deduping to one appearance (14.3)
 * - a med spanning all four time-of-day blocks (14.3)
 * - non-contiguous present blocks preserving the fixed presentation order while
 *   omitting empty blocks (14.1, 14.5)
 * - deterministic alphabetical id tiebreak for equal drug names (14.1, 14.2)
 */

let seq = 0;
function med(
  drugName: string,
  schedule: MedicationSchedule,
  overrides: Partial<MedicationProfile> = {},
): MedicationProfile {
  return {
    id: `u-${++seq}`,
    op_timestamp: '2026-01-01T00:00:00.000Z',
    drugName,
    dosage: '5mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'Condition',
    active: true,
    schedule,
    ...overrides,
  };
}

const weekly = (times: string[]): MedicationSchedule => ({
  kind: 'weekly',
  daysOfWeek: ['MON'],
  times,
});

/** Build N distinct active meds each scheduled in the morning (08:00). */
function morningMeds(n: number): MedicationProfile[] {
  return Array.from({ length: n }, (_, i) =>
    med(`AM-${String(i).padStart(2, '0')}`, weekly(['08:00'])),
  );
}

describe('buildPolypharmacyView — boundary edges not covered by view.test.ts', () => {
  it('excludes soft-deleted meds from the active count (12 records, 2 deleted → 10 active → flat)', () => {
    const meds = [
      ...morningMeds(10),
      med('Gone', weekly(['08:00']), { deleted: true }),
      med('AlsoGone', weekly(['09:00']), { deleted: true }),
    ];
    const view = buildPolypharmacyView(meds);
    expect(view.layout).toBe('flat');
    if (view.layout !== 'flat') return;
    expect(view.medications).toHaveLength(10);
    const names = view.medications.map((m) => m.drugName);
    expect(names).not.toContain('Gone');
    expect(names).not.toContain('AlsoGone');
  });

  it('keeps grouped layout when an 11th active med tips the count even though others are deleted', () => {
    // 11 active + 1 deleted = 11 active → grouped (deleted does not reduce below boundary).
    const meds = [...morningMeds(11), med('Gone', weekly(['08:00']), { deleted: true })];
    const view = buildPolypharmacyView(meds);
    expect(view.layout).toBe('grouped');
  });

  it('counts PRN/as-needed meds toward the >10 boundary and routes them to As Needed', () => {
    // 9 scheduled + 2 PRN = 11 active → grouped; the PRN meds land in As Needed.
    const prnA = med('Acetaminophen', { kind: 'prn' });
    const prnB = med('Zolpidem', { kind: 'prn' });
    const view = buildPolypharmacyView([...morningMeds(9), prnA, prnB]);
    expect(view.layout).toBe('grouped');
    if (view.layout !== 'grouped') return;
    expect(view.asNeeded.map((m) => m.drugName)).toEqual(['Acetaminophen', 'Zolpidem']);
    const blockIds = view.blocks.flatMap((b) => b.medications.map((m) => m.id));
    expect(blockIds).not.toContain(prnA.id);
    expect(blockIds).not.toContain(prnB.id);
  });

  it('includes a PRN med in the flat list when the active count is exactly 10', () => {
    const prn = med('Ondansetron', { kind: 'prn' });
    const view = buildPolypharmacyView([...morningMeds(9), prn]);
    expect(view.layout).toBe('flat');
    if (view.layout !== 'flat') return;
    expect(view.medications).toHaveLength(10);
    expect(view.medications.map((m) => m.drugName)).toContain('Ondansetron');
  });
});

describe('buildPolypharmacyView — time-block assignment edges (14.3, 14.4)', () => {
  it('treats a malformed scheduled-time string as no-scheduled-time → As Needed', () => {
    const bad = med('BadTime', weekly(['25:00', 'noon', '8:5']));
    const view = buildPolypharmacyView([bad, ...morningMeds(11)]);
    expect(view.layout).toBe('grouped');
    if (view.layout !== 'grouped') return;
    expect(view.asNeeded.map((m) => m.id)).toContain(bad.id);
    const blockIds = view.blocks.flatMap((b) => b.medications.map((m) => m.id));
    expect(blockIds).not.toContain(bad.id);
  });

  it('assigns 23:59 to Night/Bedtime (upper pre-midnight edge)', () => {
    const lateNight = med('LateNight', weekly(['23:59']));
    const view = buildPolypharmacyView([lateNight, ...morningMeds(11)]);
    if (view.layout !== 'grouped') throw new Error('expected grouped');
    const night = view.blocks.find((b) => b.block === 'Night/Bedtime')!;
    expect(night.medications.map((m) => m.id)).toContain(lateNight.id);
  });

  it('places a med with two times in the SAME block only once (dedup within block)', () => {
    const twice = med('TwiceMorning', weekly(['06:00', '09:30']));
    const view = buildPolypharmacyView([twice, ...morningMeds(11)]);
    if (view.layout !== 'grouped') throw new Error('expected grouped');
    const appearances = view.blocks
      .flatMap((b) => b.medications)
      .filter((m) => m.id === twice.id);
    expect(appearances).toHaveLength(1);
    expect(appearances[0]!.drugName).toBe('TwiceMorning');
    const morning = view.blocks.find((b) => b.block === 'Morning')!;
    expect(morning.medications.filter((m) => m.id === twice.id)).toHaveLength(1);
  });

  it('places a med scheduled across all four windows into every block', () => {
    const everywhere = med('Everywhere', weekly(['07:00', '12:00', '18:00', '22:30']));
    const view = buildPolypharmacyView([everywhere, ...morningMeds(11)]);
    if (view.layout !== 'grouped') throw new Error('expected grouped');
    const blocksWith = view.blocks
      .filter((b) => b.medications.some((m) => m.id === everywhere.id))
      .map((b) => b.block);
    expect(blocksWith).toEqual(['Morning', 'Midday', 'Evening', 'Night/Bedtime']);
  });
});

describe('buildPolypharmacyView — empty-block omission preserves fixed order (14.1, 14.5)', () => {
  it('omits Morning and Evening while keeping Midday before Night/Bedtime', () => {
    // All 11 meds sit only in Midday or Night → those two blocks appear in fixed order.
    const meds = [
      ...Array.from({ length: 6 }, (_, i) => med(`Mid-${i}`, weekly(['12:00']))),
      ...Array.from({ length: 5 }, (_, i) => med(`Nite-${i}`, weekly(['23:00']))),
    ];
    const view = buildPolypharmacyView(meds);
    if (view.layout !== 'grouped') throw new Error('expected grouped');
    expect(view.blocks.map((b) => b.block)).toEqual(['Midday', 'Night/Bedtime']);
    expect(view.asNeeded).toEqual([]);
  });
});

describe('buildPolypharmacyView — deterministic id tiebreak for equal names (14.1, 14.2)', () => {
  it('orders meds with identical names by ascending id in the flat list', () => {
    const a = med('Same', weekly(['08:00']), { id: 'id-b' });
    const b = med('Same', weekly(['08:00']), { id: 'id-a' });
    const view = buildPolypharmacyView([a, b]);
    expect(view.layout).toBe('flat');
    if (view.layout !== 'flat') return;
    expect(view.medications.map((m) => m.id)).toEqual(['id-a', 'id-b']);
  });

  it('orders meds with identical names by ascending id within a block', () => {
    const a = med('Dup', weekly(['08:00']), { id: 'id-z' });
    const b = med('Dup', weekly(['08:00']), { id: 'id-m' });
    const view = buildPolypharmacyView([a, b, ...morningMeds(11)]);
    if (view.layout !== 'grouped') throw new Error('expected grouped');
    const morning = view.blocks.find((b) => b.block === 'Morning')!;
    const dupIds = morning.medications.filter((m) => m.drugName === 'Dup').map((m) => m.id);
    expect(dupIds).toEqual(['id-m', 'id-z']);
  });
});
