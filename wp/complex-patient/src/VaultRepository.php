<?php

declare(strict_types=1);

namespace ComplexPatient;

/**
 * wpdb-backed data access for the `wp_complex_patient_vault` table.
 *
 * Every operation is scoped to a single (wp_user_id, vault_type) pair so a
 * user can only ever read or write their own blob for a given partition
 * (Requirement 4.4). Reads and writes only ever touch the opaque encrypted
 * envelope fields — `iv`, `auth_tag`, `ciphertext` — plus the `sync_version`
 * concurrency token; the repository never interprets the ciphertext plaintext
 * (Requirement 4.6).
 *
 * Inserts that would violate the UNIQUE KEY on (wp_user_id, vault_type) are
 * rejected with a {@see DuplicateVaultException} and the existing stored row is
 * left untouched (Requirement 9.6).
 *
 * Concurrency validation (sync_version comparison) and HTTP-level concerns are
 * intentionally NOT handled here; they live in the controller / concurrency
 * layers. This class is a thin, scoped persistence boundary.
 */
final class VaultRepository
{
    public function __construct(private readonly \wpdb $wpdb)
    {
    }

    /**
     * Fully prefixed vault table name.
     */
    private function table(): string
    {
        return Activation::tableName($this->wpdb);
    }

    /**
     * Read the stored blob for a user/partition.
     *
     * Returns only the blind envelope and concurrency token — never the
     * internal id, ownership, or timestamp columns (Requirement 4.6). The
     * query is scoped to the caller's wp_user_id (Requirement 4.4).
     *
     * @return array{sync_version:int, iv:string, auth_tag:string, ciphertext:string}|null
     *         The blob, or null when no row exists for the pair.
     */
    public function find(int $wpUserId, string $vaultType): ?array
    {
        $sql = $this->wpdb->prepare(
            "SELECT sync_version, iv, auth_tag, ciphertext
             FROM {$this->table()}
             WHERE wp_user_id = %d AND vault_type = %s",
            $wpUserId,
            $vaultType
        );

        $row = $this->wpdb->get_row($sql, ARRAY_A);

        if (! is_array($row) || [] === $row) {
            return null;
        }

        return [
            'sync_version' => (int) $row['sync_version'],
            'iv'           => (string) $row['iv'],
            'auth_tag'     => (string) $row['auth_tag'],
            'ciphertext'   => (string) $row['ciphertext'],
        ];
    }

    /**
     * Insert the initial blob for a user/partition.
     *
     * IF a row already exists for the (wp_user_id, vault_type) combination,
     * the UNIQUE KEY constraint is violated; this method rejects the write,
     * leaves the existing row unchanged, and throws a
     * {@see DuplicateVaultException} identifying the duplicate combination
     * (Requirement 9.6).
     *
     * @throws DuplicateVaultException When the (wp_user_id, vault_type) pair already exists.
     * @throws \RuntimeException       When the insert fails for any other reason.
     */
    public function insert(
        int $wpUserId,
        string $vaultType,
        string $iv,
        string $authTag,
        string $ciphertext,
        int $syncVersion,
        ?string $clientUpdatedAt,
        string $serverUpdatedAt
    ): void {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->insert(
            $this->table(),
            [
                'wp_user_id'        => $wpUserId,
                'vault_type'        => $vaultType,
                'iv'                => $iv,
                'auth_tag'          => $authTag,
                'ciphertext'        => $ciphertext,
                'sync_version'      => $syncVersion,
                'client_updated_at' => $clientUpdatedAt,
                'server_updated_at' => $serverUpdatedAt,
            ],
            ['%d', '%s', '%s', '%s', '%s', '%d', '%s', '%s']
        );

        if (false !== $result) {
            return;
        }

        // A failed insert must not leave any partial state. The UNIQUE KEY
        // violation is the expected, recoverable case (Requirement 9.6).
        if ($this->isDuplicateKeyError((string) $this->wpdb->last_error)) {
            throw new DuplicateVaultException($wpUserId, $vaultType);
        }

        throw new \RuntimeException(
            sprintf(
                'Failed to insert vault blob for (wp_user_id, vault_type) (%d, "%s"). %s',
                $wpUserId,
                $vaultType,
                '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
            )
        );
    }

    /**
     * Update the stored blob for an existing user/partition.
     *
     * The WHERE clause is scoped to the caller's wp_user_id and vault_type so
     * one user can never overwrite another user's blob (Requirement 4.4). Only
     * the encrypted envelope, sync_version, and update timestamps are written
     * (Requirement 4.6).
     *
     * @return int Number of rows updated: 1 when a matching row was changed, 0
     *             when no matching row existed (or the values were identical).
     *
     * @throws \RuntimeException When the update fails at the database level.
     */
    public function update(
        int $wpUserId,
        string $vaultType,
        string $iv,
        string $authTag,
        string $ciphertext,
        int $syncVersion,
        ?string $clientUpdatedAt,
        string $serverUpdatedAt
    ): int {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->update(
            $this->table(),
            [
                'iv'                => $iv,
                'auth_tag'          => $authTag,
                'ciphertext'        => $ciphertext,
                'sync_version'      => $syncVersion,
                'client_updated_at' => $clientUpdatedAt,
                'server_updated_at' => $serverUpdatedAt,
            ],
            [
                'wp_user_id' => $wpUserId,
                'vault_type' => $vaultType,
            ],
            ['%s', '%s', '%s', '%d', '%s', '%s'],
            ['%d', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to update vault blob for (wp_user_id, vault_type) (%d, "%s"). %s',
                    $wpUserId,
                    $vaultType,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }

        return (int) $result;
    }

    /**
     * Detect a MySQL duplicate-key error (errno 1062) from the wpdb error text.
     */
    private function isDuplicateKeyError(string $error): bool
    {
        if ('' === $error) {
            return false;
        }

        return false !== stripos($error, 'Duplicate entry')
            || false !== stripos($error, '1062');
    }
}
