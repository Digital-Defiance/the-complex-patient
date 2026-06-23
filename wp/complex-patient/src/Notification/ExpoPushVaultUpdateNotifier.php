<?php

declare(strict_types=1);

namespace ComplexPatient\Notification;

use ComplexPatient\DeviceRepository;

/**
 * Fan-out vault-update hints to registered Expo push tokens (iOS/Android).
 *
 * Web Push subscriptions are stored but not sent until a Web Push sender is
 * configured (VAPID keys). Delivery is best-effort and never blocks vault writes.
 */
final class ExpoPushVaultUpdateNotifier implements VaultUpdateNotifier
{
    private const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

    public function __construct(private readonly DeviceRepository $devices)
    {
    }

    public function notifyVaultUpdated(
        int $userId,
        string $vaultType,
        int $syncVersion,
        ?string $originatingDeviceId
    ): void {
        $targets = $this->devices->findExpoPushTokensForUser($userId, $originatingDeviceId);

        if ([] === $targets) {
            return;
        }

        $messages = [];

        foreach ($targets as $target) {
            $messages[] = [
                'to'    => $target,
                'title' => 'Vault updated',
                'body'  => 'New health data is available on another device.',
                'data'  => [
                    'type'         => 'vault_updated',
                    'vault_type'   => $vaultType,
                    'sync_version' => $syncVersion,
                ],
                'sound' => 'default',
            ];
        }

        if (! function_exists('wp_remote_post')) {
            return;
        }

        wp_remote_post(
            self::EXPO_PUSH_URL,
            [
                'headers'  => [
                    'Content-Type' => 'application/json',
                    'Accept'       => 'application/json',
                ],
                'body'     => wp_json_encode($messages),
                'timeout'  => 5,
                'blocking' => false,
            ]
        );
    }
}
