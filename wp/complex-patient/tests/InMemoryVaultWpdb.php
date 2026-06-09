<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

/**
 * In-memory test double for $wpdb that emulates the single-table behaviour the
 * VaultRepository depends on: scoped SELECTs, INSERT with UNIQUE KEY
 * enforcement on (wp_user_id, vault_type), and scoped UPDATE.
 *
 * It deliberately models the real wpdb contract:
 *  - insert()/update() return the affected row count or false on error and set
 *    $last_error;
 *  - a UNIQUE KEY violation sets $last_error to a MySQL "Duplicate entry"
 *    message and returns false (mirroring errno 1062).
 */
final class InMemoryVaultWpdb extends \wpdb
{
    /**
     * Rows keyed by "wp_user_id|vault_type".
     *
     * @var array<string, array<string, mixed>>
     */
    public array $rows = [];

    private int $autoIncrement = 1;

    /** Force the next write to fail with a generic (non-duplicate) error. */
    public bool $forceGenericError = false;

    public function get_row(string $query, $output = ARRAY_A)
    {
        // Parse the scoped SELECT: wp_user_id = %d AND vault_type = %s, where
        // prepare() has already substituted the literal values.
        if (! preg_match("/wp_user_id = (\d+) AND vault_type = '([^']*)'/", $query, $m)) {
            return null;
        }

        $key = $this->key((int) $m[1], $m[2]);
        if (! isset($this->rows[$key])) {
            return null;
        }

        $row = $this->rows[$key];

        // Mimic the column projection of the repository SELECT.
        return [
            'sync_version' => $row['sync_version'],
            'iv'           => $row['iv'],
            'auth_tag'     => $row['auth_tag'],
            'ciphertext'   => $row['ciphertext'],
        ];
    }

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

        $key = $this->key((int) $data['wp_user_id'], (string) $data['vault_type']);

        if (isset($this->rows[$key])) {
            // UNIQUE KEY uniq_user_vault (wp_user_id, vault_type) violation.
            $this->last_error = sprintf(
                "Duplicate entry '%d-%s' for key 'uniq_user_vault'",
                (int) $data['wp_user_id'],
                (string) $data['vault_type']
            );

            return false;
        }

        $data['id'] = $this->autoIncrement++;
        $this->rows[$key] = $data;

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

        $key = $this->key((int) $where['wp_user_id'], (string) $where['vault_type']);

        if (! isset($this->rows[$key])) {
            return 0;
        }

        $this->rows[$key] = array_merge($this->rows[$key], $data);

        return 1;
    }

    private function key(int $wpUserId, string $vaultType): string
    {
        return $wpUserId . '|' . $vaultType;
    }
}
