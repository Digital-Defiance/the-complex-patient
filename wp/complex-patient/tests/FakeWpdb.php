<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

/**
 * In-memory test double for the WordPress $wpdb global.
 *
 * Records dbDelta and DROP TABLE interactions and lets a test control whether
 * the vault table is reported as existing after dbDelta runs, so activation
 * success and failure paths can be exercised without a database.
 */
final class FakeWpdb extends \wpdb
{
    public bool $tableExistsAfterDbDelta = true;

    /** @var list<string> */
    public array $dbDeltaCalls = [];

    /** @var list<string> */
    public array $droppedTables = [];

    public function get_var(string $query)
    {
        // Emulate SHOW TABLES LIKE 'wp_complex_patient_vault'.
        if (str_contains($query, 'SHOW TABLES LIKE')) {
            return $this->tableExistsAfterDbDelta ? $this->prefix . \ComplexPatient\Activation::TABLE_BASENAME : null;
        }

        return null;
    }

    public function query(string $query)
    {
        if (str_starts_with($query, 'DROP TABLE')) {
            // Record the unprefixed/prefixed table name that was dropped.
            if (preg_match('/DROP TABLE IF EXISTS\s+(\S+)/i', $query, $m)) {
                $this->droppedTables[] = $m[1];
            }
        }

        return 0;
    }

    public function recordDbDelta(string $sql): void
    {
        $this->dbDeltaCalls[] = $sql;
    }
}
