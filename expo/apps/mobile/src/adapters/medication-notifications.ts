/**
 * Native local notification scheduling for medication doses.
 */

import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import { suspendBackgroundLock } from '@complex-patient/ui';
import type { MedicationProfile } from '@complex-patient/domain';
import {
  buildMedicationNotificationTriggers,
  notificationTriggerId,
} from '@complex-patient/medications';

export async function syncMedicationNotifications(
  medications: readonly MedicationProfile[],
): Promise<void> {
  // expo-notifications throws on import in Expo Go on Android (SDK 53+).
  if (Platform.OS === 'android' && isRunningInExpoGo()) {
    return;
  }

  try {
    const Notifications = await import('expo-notifications');
    const endBackgroundLockSuspension = suspendBackgroundLock();
    let permission;
    try {
      permission = await Notifications.requestPermissionsAsync();
    } finally {
      endBackgroundLockSuspension();
    }
    if (!permission.granted) {
      return;
    }
    await Notifications.cancelAllScheduledNotificationsAsync();

    const triggers = buildMedicationNotificationTriggers(medications);
    for (const trigger of triggers) {
      const when = Date.parse(trigger.scheduledAt);
      if (Number.isNaN(when) || when <= Date.now()) {
        continue;
      }

      await Notifications.scheduleNotificationAsync({
        identifier: notificationTriggerId(trigger.medicationId, trigger.regimenId, trigger.scheduledAt),
        content: {
          title: trigger.title,
          body: trigger.body,
          data: { medicationId: trigger.medicationId, regimenId: trigger.regimenId },
        },
        trigger: new Date(when),
      });
    }
  } catch {
    // Notifications unavailable in this runtime (simulator, denied permission, etc.).
  }
}
