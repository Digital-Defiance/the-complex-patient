/**
 * Native local notification scheduling for medication doses.
 */

import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
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
    await Notifications.requestPermissionsAsync();
    await Notifications.cancelAllScheduledNotificationsAsync();

    const triggers = buildMedicationNotificationTriggers(medications);
    for (const trigger of triggers) {
      const when = Date.parse(trigger.scheduledAt);
      if (Number.isNaN(when) || when <= Date.now()) {
        continue;
      }

      await Notifications.scheduleNotificationAsync({
        identifier: notificationTriggerId(trigger.medicationId, trigger.scheduledAt),
        content: {
          title: trigger.title,
          body: trigger.body,
          data: { medicationId: trigger.medicationId },
        },
        trigger: new Date(when),
      });
    }
  } catch {
    // Notifications unavailable in this runtime (simulator, denied permission, etc.).
  }
}
