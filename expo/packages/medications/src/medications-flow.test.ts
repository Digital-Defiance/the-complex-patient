import { describe, it, expect } from 'vitest';
import type { MedicationProfile } from '@complex-patient/domain';
import { expandDosesForDay } from './schedule';
import { buildTodayQueue } from './today';
import { recordDoseTaken } from './adherence';

function profile(overrides: Partial<MedicationProfile> = {}): MedicationProfile {
  return {
    id: 'med-1',
    op_timestamp: '2026-06-01T00:00:00.000Z',
    drugName: 'Metoprolol',
    dosage: '25mg',
    form: 'tablet',
    prescribingPhysician: 'Dr. Smith',
    conditionTreated: 'POTS',
    active: true,
    schedule: { kind: 'weekly', daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], times: ['08:00'] },
    ...overrides,
  };
}

describe('expandDosesForDay', () => {
  it('emits one slot per scheduled time', () => {
    const slots = expandDosesForDay([profile()], '2026-06-14');
    expect(slots).toHaveLength(1);
    expect(slots[0]?.scheduledAt).toBe('2026-06-14T08:00:00.000Z');
  });
});

describe('buildTodayQueue', () => {
  it('marks dose taken when med event exists', () => {
    const queue = buildTodayQueue({
      medications: [profile()],
      medEvents: [
        {
          id: 'evt-1',
          op_timestamp: '2026-06-14T08:05:00.000Z',
          medicationId: 'med-1',
          scheduledAt: '2026-06-14T08:00:00.000Z',
          takenAt: '2026-06-14T08:05:00.000Z',
          status: 'taken',
        },
      ],
      day: '2026-06-14',
      now: new Date('2026-06-14T09:00:00.000Z'),
    });
    expect(queue.scheduled[0]?.status).toBe('taken');
  });
});

describe('recordDoseTaken', () => {
  it('upserts a med event into partition records', () => {
    const result = recordDoseTaken({
      current: [],
      medicationId: 'med-1',
      scheduledAt: '2026-06-14T08:00:00.000Z',
      takenAt: '2026-06-14T08:05:00.000Z',
    });
    expect(result.records).toHaveLength(1);
    expect(result.event.takenAt).toBe('2026-06-14T08:05:00.000Z');
  });
});
