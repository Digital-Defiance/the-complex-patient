/**
 * Expo push registration and vault-update notification handling (native).
 */

import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type { HomeEntryController } from '@complex-patient/ui';

const VAULT_UPDATED_TYPE = 'vault_updated';

function readProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

function isVaultUpdateNotification(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  return (data as { type?: string }).type === VAULT_UPDATED_TYPE;
}

export interface VaultUpdatePushSession {
  dispose(): void;
}

/**
 * Register for remote vault-update pushes and reconcile when notifications arrive.
 */
export async function startVaultUpdatePushSession(
  home: HomeEntryController,
): Promise<VaultUpdatePushSession | null> {
  if (Platform.OS === 'android' && isRunningInExpoGo()) {
    return null;
  }

  try {
    const Notifications = await import('expo-notifications');

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      return null;
    }

    const projectId = readProjectId();
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const pushToken = tokenResult.data;

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const registered = await home.registerDevicePush({
      platform,
      push_token: pushToken,
      push_provider: 'expo',
    });

    if (!registered.ok) {
      console.warn('[VaultUpdatePush] device registration failed (check WordPress /devices endpoint)');
      return null;
    }
    console.info('[VaultUpdatePush] registered for vault-update notifications');

    const onNotification = (notification: { request: { content: { data?: unknown } } }) => {
      if (!isVaultUpdateNotification(notification.request.content.data)) {
        return;
      }
      const status = home.getStatus();
      if (status === 'ready') {
        home.onConnectivityRestored();
        return;
      }
      // Locked or signed-out: pull on the next successful unlock.
      home.markRemoteReconcilePending();
    };

    const receivedSubscription = Notifications.addNotificationReceivedListener(onNotification);
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      onNotification(response.notification);
    });

    return {
      dispose() {
        receivedSubscription.remove();
        responseSubscription.remove();
      },
    };
  } catch {
    return null;
  }
}
