import { describe, it, expect } from 'vitest';
import type { MedicationProfile, MedicationSchedule } from '@complex-patient/domain';
import { buildPolypharmacyView } from './index';
import { makeMedicationProfile } from './test-fixtures';

/**
 * Unit tests for the adaptive polypharmacy view (Task 11.5; validates 14.1–14.5).
 *
 * Covers:
 * - the >10 / ≤10 boundary (flat vs grouped) (14.1, 14.2)
 * - alphabetical ordering within block and within the flat list (14.1, 14.2)
 * - time-block window assignment (14.3)
 * - multi-time meds placed in each matching block (14.3)
 * - no-time / PRN → "As Needed" after Night/Bedtime (14.4)
 * - empty blocks omitted (14.5)
 */

let seq = 0;
function med(
  drugName: string,
  schedule: MedicationSchedule,
  overrides: Partial<MedicationProfile> = {},
): MedicationProfile {
  return makeMedicationProfile({
    id: `m-${++seq}`,
    drugName,
    schedule,
    ...overrides,
  });
}

const weekly = (times: string[]): MedicationSchedule => ({
  kind: 'weekly',
  daysOfWeek: ['MON'],
  times,
});

/** Build N distinct active meds each scheduled in the morning. */
function morningMeds(n: number): MedicationProfile[] {
  return Array.from({ length: n }, (_, i) =>
    med(`Morning-${String(i).padStart(2, '0')}`, weekly(['08:00'])),
  );
}

describe('buildPolypharmacyView — boundary (14.1, 14.2)', () => {
  it('produces a flat alphabetical list at exactly 10 active meds', () => {
    const meds = [
      med('Zinc', weekly(['08:00'])),
      med('Aspirin', weekly(['20:00'])),
      ...morningMeds(8),
    ];
    const view = buildPolypharmacyView(meds);
    expect(view.layout).toBe('flat');
    if (view.layout !== 'flat') return;
    expect(view.medications).toHaveLength(10);
    const names = view.medications.map((m) => m.drugName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names[0]).toBe('Aspirin');
    expect(names[names.length - 1]).toBe('Zinc');
  });

  it('switches to grouped blocks when active count exceeds 10', () => {
    const view = buildPolypharmacyView(morningMeds(11));
    expect(view.layout).toBe('grouped');
  });

  it('excludes inactive meds from the active count and the view', () => {
    // 11 meds total but one inactive → 10 active → flat.
    const meds = [...morningMeds(10), med('Inactive', weekly(['08:00']), { active: false })];
    const view = buildPolypharmacyView(meds);
    expect(view.layout).toBe('flat');
    if (view.layout !== 'flat') return;
    expect(view.medications.map((m) => m.drugName)).not.toContain('Inactive');
    expect(view.medications).toHaveLength(10);
  });
});

describe('buildPolypharmacyView — time-block assignment (14.3)', () => {
  it('assigns each time to the correct block window', () => {
    const meds = [
      med('Morn', weekly(['05:00'])), // Morning lower edge
      med('MornEnd', weekly(['10:59'])), // Morning upper edge
      med('Mid', weekly(['11:00'])), // Midday lower edge
      med('MidEnd', weekly(['16:59'])),
      med('Eve', weekly(['17:00'])),
      med('EveEnd', weekly(['21:59'])),
      med('Night', weekly(['22:00'])), // Night lower edge
      med('NightWrap', weekly(['04:59'])), // Night wraps past midnight
      med('Midnight', weekly(['00:00'])),
      ...morningMeds(3), // pad to exceed 10
    ];
    const view = buildPolypharmacyView(meds);
    expect(view.layout).toBe('grouped');
    if (view.layout !== 'grouped') return;

    const byBlock = Object.fromEntries(
      view.blocks.map((b) => [b.block, b.medications.map((m) => m.drugName)]),
    );
    expect(byBlock['Morning']).toContain('Morn');
    expect(byBlock['Morning']).toContain('MornEnd');
    expect(byBlock['Midday']).toContain('Mid');
    expect(byBlock['Midday']).toContain('MidEnd');
    expect(byBlock['Evening']).toContain('Eve');
    expect(byBlock['Evening']).toContain('EveEnd');
    expect(byBlock['Night/Bedtime']).toEqual(
      expect.arrayContaining(['Night', 'NightWrap', 'Midnight']),
    );
  });

  it('presents blocks in fixed order and sorts alphabetically within block', () => {
    const meds = [
      med('Zeta', weekly(['08:00'])),
      med('Alpha', weekly(['08:00'])),
      med('Mango', weekly(['12:00'])),
      med('Banana', weekly(['12:00'])),
      med('Yarrow', weekly(['18:00'])),
      med('Xenon', weekly(['23:00'])),
      ...morningMeds(6),
    ];
    const view = buildPolypharmacyView(meds);
    if (view.layout !== 'grouped') throw new Error('expected grouped');

    expect(view.blocks.map((b) => b.block)).toEqual([
      'Morning',
      'Midday',
      'Evening',
      'Night/Bedtime',
    ]);
    const morning = view.blocks.find((b) => b.block === 'Morning')!;
    const names = morning.medications.map((m) => m.drugName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names[0]).toBe('Alpha');
    // Midday sorted: Banana before Mango.
    const midday = view.blocks.find((b) => b.block === 'Midday')!;
    expect(midday.medications.map((m) => m.drugName)).toEqual(['Banana', 'Mango']);
  });
});

describe('buildPolypharmacyView — multi-block placement (14.3)', () => {
  it('places a med with multiple scheduled times into each matching block', () => {
    const multi = med('Multi', weekly(['08:00', '13:00', '23:00']));
    const view = buildPolypharmacyView([multi, ...morningMeds(11)]);
    if (view.layout !== 'grouped') throw new Error('expected grouped');

    const blocksWithMulti = view.blocks
      .filter((b) => b.medications.some((m) => m.id === multi.id))
      .map((b) => b.block);
    expect(blocksWithMulti).toEqual(['Morning', 'Midday', 'Night/Bedtime']);
  });
});

describe('buildPolypharmacyView — As Needed section (14.4)', () => {
  it('routes PRN and no-scheduled-time meds to As Needed after the blocks', () => {
    const prn = med('PrnMed', { kind: 'prn' });
    const taper = med('TaperMed', { kind: 'taper', phases: [{ weekIndex: 0, dosage: '5mg' }] });
    const noTimes = med('NoTimes', weekly([]));
    const view = buildPolypharmacyView([prn, taper, noTimes, ...morningMeds(9)]);
    if (view.layout !== 'grouped') throw new Error('expected grouped');

    const asNeededNames = view.asNeeded.map((m) => m.drugName);
    expect(asNeededNames).toEqual(['NoTimes', 'PrnMed', 'TaperMed']); // alphabetical
    // None of the As Needed meds appear in time blocks.
    const blockIds = view.blocks.flatMap((b) => b.medications.map((m) => m.id));
    expect(blockIds).not.toContain(prn.id);
    expect(blockIds).not.toContain(taper.id);
    expect(blockIds).not.toContain(noTimes.id);
  });
});

describe('buildPolypharmacyView — empty block omission (14.5)', () => {
  it('omits blocks that contain zero medications', () => {
    // 11 meds all in the morning → only the Morning block should appear.
    const view = buildPolypharmacyView(morningMeds(11));
    if (view.layout !== 'grouped') throw new Error('expected grouped');
    expect(view.blocks.map((b) => b.block)).toEqual(['Morning']);
    expect(view.asNeeded).toEqual([]);
  });
});
