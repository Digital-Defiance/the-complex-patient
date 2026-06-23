<?php

declare(strict_types=1);

namespace ComplexPatient;

/**
 * wpdb-backed data access for registered push devices.
 */
final class DeviceRepository
{
    public function __construct(private readonly \wpdb $wpdb)
    {
    }

    private function table(): string
    {
        return Activation::deviceTableName($this->wpdb);
    }

    /**
     * @return list<string> Expo push tokens for the user, excluding $excludeDeviceId.
     */
    public function findExpoPushTokensForUser(int $wpUserId, ?string $excludeDeviceId = null): array
    {
        $sql = $this->wpdb->prepare(
            "SELECT device_id, push_token
             FROM {$this->table()}
             WHERE wp_user_id = %d
               AND push_provider = 'expo'
               AND push_token <> ''",
            $wpUserId
        );

        $rows = $this->wpdb->get_results($sql, ARRAY_A);

        if (! is_array($rows)) {
            return [];
        }

        $tokens = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $deviceId = isset($row['device_id']) ? (string) $row['device_id'] : '';
            if (null !== $excludeDeviceId && '' !== $deviceId && $deviceId === $excludeDeviceId) {
                continue;
            }

            $token = (string) ($row['push_token'] ?? '');

            if ('' !== $token) {
                $tokens[] = $token;
            }
        }

        return array_values(array_unique($tokens));
    }

    /**
     * @return array{device_id:string, platform:string, push_token:string, push_provider:string}|null
     */
    public function findByUserAndDeviceId(int $wpUserId, string $deviceId): ?array
    {
        $sql = $this->wpdb->prepare(
            "SELECT device_id, platform, push_token, push_provider
             FROM {$this->table()}
             WHERE wp_user_id = %d AND device_id = %s",
            $wpUserId,
            $deviceId
        );

        $row = $this->wpdb->get_row($sql, ARRAY_A);

        if (! is_array($row) || [] === $row) {
            return null;
        }

        return [
            'device_id'      => (string) $row['device_id'],
            'platform'       => (string) $row['platform'],
            'push_token'     => (string) $row['push_token'],
            'push_provider'  => (string) $row['push_provider'],
        ];
    }

    /**
     * @throws \RuntimeException When persistence fails.
     */
    public function upsert(
        int $wpUserId,
        string $deviceId,
        string $platform,
        string $pushToken,
        string $pushProvider,
        string $serverUpdatedAt
    ): void {
        $existing = $this->findByUserAndDeviceId($wpUserId, $deviceId);

        if (null === $existing) {
            $this->insert($wpUserId, $deviceId, $platform, $pushToken, $pushProvider, $serverUpdatedAt);

            return;
        }

        $this->update($wpUserId, $deviceId, $platform, $pushToken, $pushProvider, $serverUpdatedAt);
    }

    /**
     * @throws \RuntimeException When the insert fails.
     */
    public function insert(
        int $wpUserId,
        string $deviceId,
        string $platform,
        string $pushToken,
        string $pushProvider,
        string $serverUpdatedAt
    ): void {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->insert(
            $this->table(),
            [
                'wp_user_id'        => $wpUserId,
                'device_id'         => $deviceId,
                'platform'          => $platform,
                'push_token'        => $pushToken,
                'push_provider'     => $pushProvider,
                'last_seen_at'      => $serverUpdatedAt,
                'server_updated_at' => $serverUpdatedAt,
            ],
            ['%d', '%s', '%s', '%s', '%s', '%s', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to insert device registration for wp_user_id %d. %s',
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }
    }

    /**
     * @throws \RuntimeException When the update fails.
     */
    public function update(
        int $wpUserId,
        string $deviceId,
        string $platform,
        string $pushToken,
        string $pushProvider,
        string $serverUpdatedAt
    ): void {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->update(
            $this->table(),
            [
                'platform'          => $platform,
                'push_token'        => $pushToken,
                'push_provider'     => $pushProvider,
                'last_seen_at'      => $serverUpdatedAt,
                'server_updated_at' => $serverUpdatedAt,
            ],
            [
                'wp_user_id' => $wpUserId,
                'device_id'  => $deviceId,
            ],
            ['%s', '%s', '%s', '%s', '%s'],
            ['%d', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to update device registration for wp_user_id %d. %s',
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }
    }

  /**
   * @return int Number of rows deleted.
   */
    public function delete(int $wpUserId, string $deviceId): int
    {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->delete(
            $this->table(),
            [
                'wp_user_id' => $wpUserId,
                'device_id'  => $deviceId,
            ],
            ['%d', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to delete device registration for wp_user_id %d. %s',
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }

        return (int) $result;
    }
}
