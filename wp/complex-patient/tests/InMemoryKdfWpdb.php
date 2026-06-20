<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

/**
 * In-memory test double for $wpdb backing {@see KdfMaterialRepository}.
 */
final class InMemoryKdfWpdb extends \wpdb
{
    /** @var array<int, array<string, mixed>> */
    public array $rows = [];

    private int $autoIncrement = 1;

    public bool $forceGenericError = false;

    public function get_row(string $query, $output = ARRAY_A)
    {
        if (! preg_match('/wp_user_id = (\d+)/', $query, $m)) {
            return null;
        }

        $userId = (int) $m[1];

        if (! isset($this->rows[$userId])) {
            return null;
        }

        $row = $this->rows[$userId];

        return [
            'salt_base64'     => $row['salt_base64'],
            'kdf_params_json' => $row['kdf_params_json'],
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

        $userId = (int) $data['wp_user_id'];

        if (isset($this->rows[$userId])) {
            $this->last_error = sprintf(
                "Duplicate entry '%d' for key 'uniq_user'",
                $userId
            );

            return false;
        }

        $data['id'] = $this->autoIncrement++;
        $this->rows[$userId] = $data;

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

        $userId = (int) $where['wp_user_id'];

        if (! isset($this->rows[$userId])) {
            return 0;
        }

        $this->rows[$userId] = array_merge($this->rows[$userId], $data);

        return 1;
    }
}
