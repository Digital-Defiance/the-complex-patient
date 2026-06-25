<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

/**
 * In-memory test double for $wpdb backing {@see PaperBackupRepository}.
 */
final class InMemoryPaperBackupWpdb extends \wpdb
{
    /** @var array<string, array<string, mixed>> keyed by backup_id */
    public array $rows = [];

    public bool $forceGenericError = false;

    /**
     * @param array<string, mixed> $data
     * @param array<int, string>   $format
     */
    public function insert(string $table, array $data, $format = null)
    {
        $this->last_error = '';

        if ($this->forceGenericError) {
            $this->last_error = 'MySQL server has gone away';

            return false;
        }

        $backupId = (string) $data['backup_id'];
        if (isset($this->rows[$backupId])) {
            $this->last_error = 'Duplicate entry';

            return false;
        }

        $this->rows[$backupId] = $data;

        return 1;
    }

    public function get_results(string $query, $output = ARRAY_A)
    {
        if (! preg_match('/wp_user_id = (\d+)/', $query, $match)) {
            return [];
        }

        $userId = (int) $match[1];
        $rows   = [];

        foreach ($this->rows as $row) {
            if ((int) $row['wp_user_id'] !== $userId) {
                continue;
            }
            $rows[] = [
                'backup_id'  => $row['backup_id'],
                'label'      => $row['label'],
                'created_at' => $row['created_at'],
            ];
        }

        return $rows;
    }

    public function get_row(string $query, $output = ARRAY_A)
    {
        if (! preg_match('/wp_user_id = (\d+) AND backup_id = \'([^\']+)\'/', $query, $match)) {
            return null;
        }

        $userId   = (int) $match[1];
        $backupId = $match[2];

        if (! isset($this->rows[$backupId])) {
            return null;
        }

        $row = $this->rows[$backupId];
        if ((int) $row['wp_user_id'] !== $userId) {
            return null;
        }

        return $row;
    }

    /**
     * @param array<string, mixed> $where
     * @param array<int, string>   $whereFormat
     */
    public function delete(string $table, array $where, $whereFormat = null)
    {
        $this->last_error = '';

        if ($this->forceGenericError) {
            $this->last_error = 'MySQL server has gone away';

            return false;
        }

        $backupId = (string) $where['backup_id'];
        $userId   = (int) $where['wp_user_id'];

        if (! isset($this->rows[$backupId]) || (int) $this->rows[$backupId]['wp_user_id'] !== $userId) {
            return 0;
        }

        unset($this->rows[$backupId]);

        return 1;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed> $where
     * @param array<int, string>   $format
     * @param array<int, string>   $whereFormat
     */
    public function update(string $table, array $data, array $where, $format = null, $whereFormat = null)
    {
        $this->last_error = '';

        if ($this->forceGenericError) {
            $this->last_error = 'MySQL server has gone away';

            return false;
        }

        $backupId = (string) $where['backup_id'];
        $userId   = (int) $where['wp_user_id'];

        if (! isset($this->rows[$backupId]) || (int) $this->rows[$backupId]['wp_user_id'] !== $userId) {
            return 0;
        }

        $this->rows[$backupId] = array_merge($this->rows[$backupId], $data);

        return 1;
    }
}
