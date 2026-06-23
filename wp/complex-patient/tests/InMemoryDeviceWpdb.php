<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

/**
 * In-memory test double for $wpdb backing {@see DeviceRepository}.
 */
final class InMemoryDeviceWpdb extends \wpdb
{
    /** @var array<string, array<string, mixed>> keyed by "{userId}:{deviceId}" */
    public array $rows = [];

    private int $autoIncrement = 1;

    public bool $forceGenericError = false;

    public function get_row(string $query, $output = ARRAY_A)
    {
        if (preg_match('/wp_user_id = (\d+) AND device_id = \'([^\']+)\'/', $query, $m)) {
            $key = $m[1] . ':' . $m[2];

            return $this->rows[$key] ?? null;
        }

        return null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function get_results(string $query, $output = ARRAY_A)
    {
        if (! preg_match('/wp_user_id = (\d+)/', $query, $m)) {
            return [];
        }

        $userId = (int) $m[1];
        $rows   = [];

        foreach ($this->rows as $key => $row) {
            if (! str_starts_with($key, $userId . ':')) {
                continue;
            }

            if (str_contains($query, "push_provider = 'expo'") && 'expo' !== ($row['push_provider'] ?? '')) {
                continue;
            }

            $rows[] = $row;
        }

        return $rows;
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

        $key = $data['wp_user_id'] . ':' . $data['device_id'];

        if (isset($this->rows[$key])) {
            $this->last_error = "Duplicate entry '{$key}' for key 'uniq_user_device'";

            return false;
        }

        $data['id']      = $this->autoIncrement++;
        $this->rows[$key] = $data;

        return 1;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed> $where
     */
    public function update(string $table, array $data, array $where, $format = null, $whereFormat = null)
    {
        $this->last_error = '';

        if ($this->forceGenericError) {
            $this->last_error = 'MySQL server has gone away';

            return false;
        }

        $key = $where['wp_user_id'] . ':' . $where['device_id'];

        if (! isset($this->rows[$key])) {
            return 0;
        }

        $this->rows[$key] = array_merge($this->rows[$key], $data);

        return 1;
    }

    /**
     * @param array<string, mixed> $where
     */
    public function delete(string $table, array $where, $whereFormat = null)
    {
        $this->last_error = '';

        $key = $where['wp_user_id'] . ':' . $where['device_id'];

        if (! isset($this->rows[$key])) {
            return 0;
        }

        unset($this->rows[$key]);

        return 1;
    }
}
