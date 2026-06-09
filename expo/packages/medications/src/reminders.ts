/**
 * @complex-patient/medications — Medication reminders and dashboard indicators
 *
 * Implements the reminder dispatch flow that runs when a scheduled medication
 * time is reached (Requirement 12). The flow is parameterized by the platform
 * (native vs web) and driven entirely through injected adapters so the decision
 * logic is deterministic and testable under vitest without a native
 * `expo-notifications` runtime or a real DOM dashboard.
 *
 * Behavioral guarantees:
 * - Native: when a scheduled medication time is reached, the client checks the
 *   device notification state and user notification permissions before
 *   attempting a push (12.1). If notifications are permitted, it triggers a
 *   local push notification (12.2). If notifications are NOT permitted, it
 *   updates the dashboard badge indicator and does NOT trigger a push (12.4).
 * - Web: when a scheduled medication time is reached, the client updates the
 *   local dashboard badge indicator (12.3); it never triggers a push.
 *
 * The "within 5 seconds" clauses (12.1, 12.2, 12.3) are latency budgets. This
 * module performs each step promptly and synchronously in flow (awaiting the
 * injected adapters) and adds no artificial delay; meeting the budget is a
 * property of the injected adapter implementations and the host scheduler.
 */

/** The runtime platform a reminder is dispatched on (22.1, 22.2). */
export type ReminderPlatform = 'native' | 'web';

/**
 * The device notification authorization/state reported by the platform
 * (Requirement 12.1). `permitted` is true only when the device notification
 * state AND the user's notification permissions both allow notifications
 * (12.2, 12.4).
 */
export interface NotificationState {
  /** True iff the OS notification state and user permission both allow push. */
  permitted: boolean;
}

/**
 * A scheduled-reminder event: a single medication whose scheduled
 * administration time has been reached.
 */
export interface MedicationReminderEvent {
  /** The medication profile id the reminder is for. */
  medicationId: string;
  /** Human-readable medication name for the push body. */
  drugName: string;
  /** The scheduled time that was reached, as ISO 8601 / "HH:mm". */
  scheduledTime: string;
}

/**
 * A local push notification request handed to the native push adapter (12.2).
 */
export interface LocalPushRequest {
  medicationId: string;
  title: string;
  body: string;
  scheduledTime: string;
}

/**
 * Checks the device notification state and user notification permissions
 * (Requirement 12.1). Injected so tests can model permitted / not-permitted
 * without a real device. Native only.
 */
export type NotificationStateChecker = () => Promise<NotificationState> | NotificationState;

/**
 * Triggers a local push notification on native (Requirement 12.2). Injected so
 * tests can assert it is (or is not) called. Native only.
 */
export type LocalPushTrigger = (request: LocalPushRequest) => Promise<void> | void;

/**
 * Updates the local dashboard badge indicator for a medication that is due
 * (Requirements 12.3, 12.4). Injected on both platforms.
 */
export type DashboardBadgeUpdater = (event: MedicationReminderEvent) => Promise<void> | void;

/**
 * Adapters injected into the reminder dispatcher. The push checker/trigger are
 * only required (and only consulted) on native (12.1, 12.2, 12.4); web only
 * needs the badge updater (12.3).
 */
export interface ReminderAdapters {
  /** Native: checks device notification state + permissions (12.1). */
  checkNotificationState?: NotificationStateChecker;
  /** Native: triggers a local push when permitted (12.2). */
  triggerLocalPush?: LocalPushTrigger;
  /** Both platforms: updates the dashboard badge indicator (12.3, 12.4). */
  updateDashboardBadge: DashboardBadgeUpdater;
}

/** The action the dispatcher took for a reminder event. */
export type ReminderOutcome =
  /** Native, permitted: a local push was triggered (12.2). */
  | { platform: 'native'; action: 'push'; permitted: true }
  /** Native, not permitted: the badge was updated and no push was sent (12.4). */
  | { platform: 'native'; action: 'badge'; permitted: false }
  /** Web: the dashboard badge was updated (12.3). */
  | { platform: 'web'; action: 'badge' };

/** Compose the push notification content for a reminder event (12.2). */
function buildPushRequest(event: MedicationReminderEvent): LocalPushRequest {
  return {
    medicationId: event.medicationId,
    title: 'Medication reminder',
    body: `Time to take ${event.drugName}`,
    scheduledTime: event.scheduledTime,
  };
}

/**
 * Dispatch a single medication reminder when its scheduled time is reached
 * (Requirement 12).
 *
 * Decision table:
 * - platform === 'web'                              → update dashboard badge (12.3)
 * - platform === 'native' AND permitted             → trigger local push (12.1 → 12.2)
 * - platform === 'native' AND NOT permitted         → update dashboard badge,
 *                                                      no push (12.1 → 12.4)
 *
 * On native the notification state is always checked first (12.1) before any
 * push is attempted. The push is triggered only after the check reports
 * `permitted` (12.2); otherwise the badge is updated and no push is sent (12.4).
 *
 * @throws if `platform` is `'native'` but no `checkNotificationState` adapter
 * was provided — native dispatch cannot satisfy the 12.1 check without it.
 */
export async function dispatchMedicationReminder(
  platform: ReminderPlatform,
  event: MedicationReminderEvent,
  adapters: ReminderAdapters,
): Promise<ReminderOutcome> {
  // Web: update the dashboard badge indicator (12.3). No notification
  // permission check and never a push.
  if (platform === 'web') {
    await adapters.updateDashboardBadge(event);
    return { platform: 'web', action: 'badge' };
  }

  // Native: check the device notification state + permissions first (12.1).
  if (adapters.checkNotificationState === undefined) {
    throw new Error('native reminder dispatch requires a checkNotificationState adapter (12.1)');
  }
  const state = await adapters.checkNotificationState();

  // Permitted: trigger a local push (12.2).
  if (state.permitted) {
    if (adapters.triggerLocalPush === undefined) {
      throw new Error('native reminder dispatch requires a triggerLocalPush adapter (12.2)');
    }
    await adapters.triggerLocalPush(buildPushRequest(event));
    return { platform: 'native', action: 'push', permitted: true };
  }

  // Not permitted: update the dashboard badge and do NOT push (12.4).
  await adapters.updateDashboardBadge(event);
  return { platform: 'native', action: 'badge', permitted: false };
}

/**
 * Dispatch reminders for a batch of medication events that are due at the same
 * scheduled time. Each event is dispatched independently via
 * {@link dispatchMedicationReminder}; the outcomes are returned in input order.
 */
export async function dispatchMedicationReminders(
  platform: ReminderPlatform,
  events: readonly MedicationReminderEvent[],
  adapters: ReminderAdapters,
): Promise<ReminderOutcome[]> {
  const outcomes: ReminderOutcome[] = [];
  for (const event of events) {
    outcomes.push(await dispatchMedicationReminder(platform, event, adapters));
  }
  return outcomes;
}
