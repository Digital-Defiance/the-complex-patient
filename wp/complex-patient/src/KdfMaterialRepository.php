<?php

declare(strict_types=1);

namespace ComplexPatient;

/**
 * wpdb-backed data access for the `wp_complex_patient_kdf` table.
 *
 * Stores the non-secret salt and KDF parameters for a WordPress user so every
 * device can derive the same KEK from the Master_Passphrase. The passphrase
 * and derived key material never cross this boundary (Requirements 1.3, 1.4).
 */
final class KdfMaterialRepository
{
    public function __construct(private readonly \wpdb $wpdb)
    {
    }

    private function table(): string
    {
        return Activation::kdfTableName($this->wpdb);
    }

    /**
     * Read stored KDF material for a user.
     *
     * @return array{salt_base64:string, params:array<string,mixed>}|null
     */
    public function find(int $wpUserId): ?array
    {
        $sql = $this->wpdb->prepare(
            "SELECT salt_base64, kdf_params_json
             FROM {$this->table()}
             WHERE wp_user_id = %d",
            $wpUserId
        );

        $row = $this->wpdb->get_row($sql, ARRAY_A);

        if (! is_array($row) || [] === $row) {
            return null;
        }

        $params = json_decode((string) $row['kdf_params_json'], true);

        if (! is_array($params)) {
            return null;
        }

        return [
            'salt_base64' => (string) $row['salt_base64'],
            'params'      => $params,
        ];
    }

    /**
     * Insert initial KDF material for a user.
     *
     * @param array<string,mixed> $params
     *
     * @throws \RuntimeException When the insert fails.
     */
    public function insert(
        int $wpUserId,
        string $saltBase64,
        array $params,
        string $serverUpdatedAt
    ): void {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->insert(
            $this->table(),
            [
                'wp_user_id'        => $wpUserId,
                'salt_base64'       => $saltBase64,
                'kdf_params_json'   => wp_json_encode($params),
                'server_updated_at' => $serverUpdatedAt,
            ],
            ['%d', '%s', '%s', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to insert KDF material for wp_user_id %d. %s',
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }
    }

    /**
     * Update stored KDF material for an existing user row.
     *
     * @param array<string,mixed> $params
     *
     * @return int Number of rows updated.
     *
     * @throws \RuntimeException When the update fails at the database level.
     */
    public function update(
        int $wpUserId,
        string $saltBase64,
        array $params,
        string $serverUpdatedAt
    ): int {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->update(
            $this->table(),
            [
                'salt_base64'       => $saltBase64,
                'kdf_params_json'   => wp_json_encode($params),
                'server_updated_at' => $serverUpdatedAt,
            ],
            ['wp_user_id' => $wpUserId],
            ['%s', '%s', '%s'],
            ['%d']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to update KDF material for wp_user_id %d. %s',
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }

        return (int) $result;
    }
}
