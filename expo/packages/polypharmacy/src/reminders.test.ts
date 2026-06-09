import { describe, it, expect, vi } from 'vitest';
import {
  dispatchMedicationReminder,
  dispatchMedicationReminders,
  type MedicationReminderEvent,
  type ReminderAdapters,
} from './index';

/**
 * Unit tests for medication reminders and dashboard indicators
 * (Task 11.8; validates Requirements 12.1, 12.2, 12.3, 12.4).
 *
 * Covers:
 * - native + permitted → checks state then triggers a local push, no badge (12.1, 12.2)
 * - native + not permitted → checks state, updates badge, no push (12.1, 12.4)
 * - web → updates badge, never checks state or pushes (12.3)
 */

const event: MedicationReminderEvent = {
  medicationId: 'm-1',
  drugName: 'Aspirin',
  scheduledTime: '08:00',
};

/** Build a fresh set of spy adapters with a configurable permission state. */
function makeAdapters(permitted: boolean) {
  const checkNotificationState = vi.fn(async () => ({ permitted }));
  const triggerLocalPush = vi.fn(async () => {});
  const updateDashboardBadge = vi.fn(async () => {});
  const adapters: ReminderAdapters = {
    checkNotificationState,
    triggerLocalPush,
    updateDashboardBadge,
  };
  return { adapters, checkNotificationState, triggerLocalPush, updateDashboardBadge };
}

describe('dispatchMedicationReminder — native permitted (12.1, 12.2)', () => {
  it('checks notification state then triggers a local push and updates no badge', async () => {
    const { adapters, checkNotificationState, triggerLocalPush, updateDashboardBadge } =
      makeAdapters(true);

    const outcome = await dispatchMedicationReminder('native', event, adapters);

    expect(checkNotificationState).toHaveBeenCalledTimes(1); // 12.1: checked first
    expect(triggerLocalPush).toHaveBeenCalledTimes(1); // 12.2: push triggered
    expect(updateDashboardBadge).not.toHaveBeenCalled(); // no badge when pushing
    expect(outcome).toEqual({ platform: 'native', action: 'push', permitted: true });

    // The check happens before the push (12.1 → 12.2).
    expect(checkNotificationState.mock.invocationCallOrder[0]).toBeLessThan(
      triggerLocalPush.mock.invocationCallOrder[0],
    );

    // Push content references the medication.
    const req = triggerLocalPush.mock.calls[0][0];
    expect(req.medicationId).toBe('m-1');
    expect(req.body).toContain('Aspirin');
    expect(req.scheduledTime).toBe('08:00');
  });
});

describe('dispatchMedicationReminder — native not permitted (12.1, 12.4)', () => {
  it('checks state, updates the dashboard badge, and does NOT trigger a push', async () => {
    const { adapters, checkNotificationState, triggerLocalPush, updateDashboardBadge } =
      makeAdapters(false);

    const outcome = await dispatchMedicationReminder('native', event, adapters);

    expect(checkNotificationState).toHaveBeenCalledTimes(1); // 12.1
    expect(triggerLocalPush).not.toHaveBeenCalled(); // 12.4: no push
    expect(updateDashboardBadge).toHaveBeenCalledTimes(1); // 12.4: badge updated
    expect(updateDashboardBadge).toHaveBeenCalledWith(event);
    expect(outcome).toEqual({ platform: 'native', action: 'badge', permitted: false });
  });

  it('throws when native dispatch lacks a notification-state checker (12.1)', async () => {
    const adapters: ReminderAdapters = {
      updateDashboardBadge: vi.fn(async () => {}),
    };
    await expect(dispatchMedicationReminder('native', event, adapters)).rejects.toThrow(
      /checkNotificationState/,
    );
  });
});

describe('dispatchMedicationReminder — web (12.3)', () => {
  it('updates the dashboard badge and never checks permission or pushes', async () => {
    const checkNotificationState = vi.fn(async () => ({ permitted: true }));
    const triggerLocalPush = vi.fn(async () => {});
    const updateDashboardBadge = vi.fn(async () => {});
    const adapters: ReminderAdapters = {
      checkNotificationState,
      triggerLocalPush,
      updateDashboardBadge,
    };

    const outcome = await dispatchMedicationReminder('web', event, adapters);

    expect(updateDashboardBadge).toHaveBeenCalledTimes(1); // 12.3
    expect(updateDashboardBadge).toHaveBeenCalledWith(event);
    expect(checkNotificationState).not.toHaveBeenCalled(); // web does not check perms
    expect(triggerLocalPush).not.toHaveBeenCalled(); // web never pushes
    expect(outcome).toEqual({ platform: 'web', action: 'badge' });
  });
});

describe('dispatchMedicationReminders — batch', () => {
  it('dispatches each event in order on native, mixing push and badge by permission', async () => {
    const { adapters, triggerLocalPush, updateDashboardBadge } = makeAdapters(true);
    const events: MedicationReminderEvent[] = [
      { medicationId: 'm-1', drugName: 'A', scheduledTime: '08:00' },
      { medicationId: 'm-2', drugName: 'B', scheduledTime: '08:00' },
    ];

    const outcomes = await dispatchMedicationReminders('native', events, adapters);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.action === 'push')).toBe(true);
    expect(triggerLocalPush).toHaveBeenCalledTimes(2);
    expect(updateDashboardBadge).not.toHaveBeenCalled();
  });

  it('updates a badge per event on web', async () => {
    const { adapters, updateDashboardBadge } = makeAdapters(true);
    const events: MedicationReminderEvent[] = [
      { medicationId: 'm-1', drugName: 'A', scheduledTime: '08:00' },
      { medicationId: 'm-2', drugName: 'B', scheduledTime: '09:00' },
    ];

    const outcomes = await dispatchMedicationReminders('web', events, adapters);

    expect(outcomes).toEqual([
      { platform: 'web', action: 'badge' },
      { platform: 'web', action: 'badge' },
    ]);
    expect(updateDashboardBadge).toHaveBeenCalledTimes(2);
  });
});
