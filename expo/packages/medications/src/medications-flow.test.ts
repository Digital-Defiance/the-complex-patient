import { describe, it, expect } from 'vitest';
import { expandDosesForDay } from './schedule';
import { buildTodayQueue } from './today';
import { recordDoseTaken } from './adherence';
import { makeMedicationProfile } from './test-fixtures';

describe('expandDosesForDay', () => {
  it('emits one slot per scheduled time', () => {
    const slots = expandDosesForDay([makeMedicationProfile()], '2026-06-14');
    expect(slots).toHaveLength(1);
    expect(slots[0]?.scheduledAt).toBe('2026-06-14T08:00:00.000Z');
    expect(slots[0]?.regimenId).toBe('reg-1');
  });

  it('emits separate slots for multiple regimens on one medication', () => {
    const med = makeMedicationProfile({
      regimens: [
        {
          id: 'reg-am',
          label: 'Morning',
          dosage: '1mg',
          form: 'tablet',
          schedule: {
            kind: 'weekly',
            daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
            times: ['08:00'],
          },
        },
        {
          id: 'reg-pm',
          label: 'Bedtime',
          dosage: '2mg',
          form: 'tablet',
          schedule: {
            kind: 'weekly',
            daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
            times: ['22:00'],
          },
        },
      ],
    });
    const slots = expandDosesForDay([med], '2026-06-14');
    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.regimenId).sort()).toEqual(['reg-am', 'reg-pm']);
  });
});

describe('buildTodayQueue', () => {
  it('marks dose taken when med event exists', () => {
    const queue = buildTodayQueue({
      medications: [makeMedicationProfile()],
      medEvents: [
        {
          id: 'evt-1',
          op_timestamp: '2026-06-14T08:05:00.000Z',
          medicationId: 'med-1',
          regimenId: 'reg-1',
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
      regimenId: 'reg-1',
      scheduledAt: '2026-06-14T08:00:00.000Z',
      takenAt: '2026-06-14T08:05:00.000Z',
    });
    expect(result.records).toHaveLength(1);
    expect(result.event.takenAt).toBe('2026-06-14T08:05:00.000Z');
    expect(result.event.regimenId).toBe('reg-1');
  });
});
