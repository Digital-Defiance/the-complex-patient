<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

/**
 * In-memory test double for the WordPress $wpdb global.
 *
 * Records dbDelta and DROP TABLE interactions and lets a test control whether
 * table creation succeeds, so activation success and failure paths can be
 * exercised without a database.
 */
final class FakeWpdb extends \wpdb
{
    /** When true, dbDelta is treated as having created the table. */
    public bool $dbDeltaCreatesTables = true;

    /** When true, a direct CREATE TABLE query succeeds. */
    public bool $directQueryCreatesTables = true;

    /** @var list<string> */
    public array $dbDeltaCalls = [];

    /** @var list<string> */
    public array $droppedTables = [];

    /** @var list<string> */
    public array $queryCalls = [];

    /** @var list<string> */
    private array $createdTables = [];

    public function get_var(string $query)
    {
        if (str_contains($query, 'SHOW TABLES LIKE')) {
            if (! preg_match("/SHOW TABLES LIKE '([^']+)'/", $query, $matches)) {
                return null;
            }

            $tableName = $matches[1];
            if (in_array($tableName, $this->createdTables, true)) {
                return $tableName;
            }

            return null;
        }

        return null;
    }

    public function query(string $query)
    {
        $this->queryCalls[] = $query;

        if (str_starts_with($query, 'DROP TABLE')) {
            if (preg_match('/DROP TABLE IF EXISTS\s+(\S+)/i', $query, $m)) {
                $this->droppedTables[] = $m[1];
                $this->createdTables = array_values(
                    array_filter(
                        $this->createdTables,
                        static fn (string $table): bool => $table !== $m[1]
                    )
                );
            }
        }

        if (
            $this->directQueryCreatesTables &&
            preg_match('/CREATE TABLE\s+(\S+)\s/i', $query, $m)
        ) {
            $this->createdTables[] = $m[1];
        }

        return 0;
    }

    public function recordDbDelta(string $sql): void
    {
        $this->dbDeltaCalls[] = $sql;

        if (
            $this->dbDeltaCreatesTables &&
            preg_match('/CREATE TABLE\s+(\S+)\s/i', $sql, $m)
        ) {
            $this->createdTables[] = $m[1];
        }
    }
}
