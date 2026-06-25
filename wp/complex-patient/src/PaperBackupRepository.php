<?php

declare(strict_types=1);

namespace ComplexPatient;

/**
 * wpdb-backed data access for the `wp_complex_patient_paper_backup` table.
 *
 * Stores opaque AES-GCM envelopes that wrap the client KEK. Ciphertext is kept
 * as the client-supplied base64 string (same as blind vault blobs). The 24-word mnemonic
 * never crosses this boundary; revocation is a hard delete with no admin recovery.
 */
final class PaperBackupRepository
{
    public function __construct(private readonly \wpdb $wpdb)
    {
    }

    private function table(): string
    {
        return Activation::paperBackupTableName($this->wpdb);
    }

    /**
     * @return list<array{backup_id:string, label:?string, created_at:string}>
     */
    public function listForUser(int $wpUserId): array
    {
        $sql = $this->wpdb->prepare(
            "SELECT backup_id, label, created_at
             FROM {$this->table()}
             WHERE wp_user_id = %d
             ORDER BY created_at DESC",
            $wpUserId
        );

        $rows = $this->wpdb->get_results($sql, ARRAY_A);
        if (! is_array($rows)) {
            return [];
        }

        $backups = [];
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $backups[] = [
                'backup_id'  => (string) $row['backup_id'],
                'label'      => isset($row['label']) && '' !== (string) $row['label']
                    ? (string) $row['label']
                    : null,
                'created_at' => (string) $row['created_at'],
            ];
        }

        return $backups;
    }

    /**
     * @return array{backup_id:string, label:?string, iv:string, auth_tag:string, ciphertext:string, created_at:string}|null
     */
    public function findForUser(int $wpUserId, string $backupId): ?array
    {
        $sql = $this->wpdb->prepare(
            "SELECT backup_id, label, iv, auth_tag, ciphertext, created_at
             FROM {$this->table()}
             WHERE wp_user_id = %d AND backup_id = %s",
            $wpUserId,
            $backupId
        );

        $row = $this->wpdb->get_row($sql, ARRAY_A);
        if (! is_array($row) || [] === $row) {
            return null;
        }

        return [
            'backup_id'  => (string) $row['backup_id'],
            'label'      => isset($row['label']) && '' !== (string) $row['label']
                ? (string) $row['label']
                : null,
            'iv'         => (string) $row['iv'],
            'auth_tag'   => (string) $row['auth_tag'],
            'ciphertext' => (string) $row['ciphertext'],
            'created_at' => (string) $row['created_at'],
        ];
    }

    /**
     * @throws \RuntimeException When the insert fails.
     */
    public function insert(
        int $wpUserId,
        string $backupId,
        ?string $label,
        string $iv,
        string $authTag,
        string $ciphertext,
        string $createdAt
    ): void {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->insert(
            $this->table(),
            [
                'backup_id'  => $backupId,
                'wp_user_id' => $wpUserId,
                'label'      => $label,
                'iv'         => $iv,
                'auth_tag'   => $authTag,
                'ciphertext' => $ciphertext,
                'created_at' => $createdAt,
            ],
            ['%s', '%d', '%s', '%s', '%s', '%s', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to insert paper backup %s for wp_user_id %d. %s',
                    $backupId,
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }
    }

    /**
     * Revoke (delete) a paper backup for a user.
     *
     * @return int Number of rows deleted.
     */
    public function deleteForUser(int $wpUserId, string $backupId): int
    {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->delete(
            $this->table(),
            [
                'wp_user_id' => $wpUserId,
                'backup_id'  => $backupId,
            ],
            ['%d', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to delete paper backup %s for wp_user_id %d. %s',
                    $backupId,
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }

        return (int) $result;
    }

    /**
     * Replace the encrypted envelope for an existing paper backup.
     *
     * @return int Number of rows updated.
     *
     * @throws \RuntimeException When the update fails.
     */
    public function updateEnvelope(
        int $wpUserId,
        string $backupId,
        string $iv,
        string $authTag,
        string $ciphertext
    ): int {
        $this->wpdb->last_error = '';

        $result = $this->wpdb->update(
            $this->table(),
            [
                'iv'         => $iv,
                'auth_tag'   => $authTag,
                'ciphertext' => $ciphertext,
            ],
            [
                'wp_user_id' => $wpUserId,
                'backup_id'  => $backupId,
            ],
            ['%s', '%s', '%s'],
            ['%d', '%s']
        );

        if (false === $result) {
            throw new \RuntimeException(
                sprintf(
                    'Failed to update paper backup %s for wp_user_id %d. %s',
                    $backupId,
                    $wpUserId,
                    '' !== (string) $this->wpdb->last_error ? $this->wpdb->last_error : 'Unknown database error.'
                )
            );
        }

        return (int) $result;
    }
}
