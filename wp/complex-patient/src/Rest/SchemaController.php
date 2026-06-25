<?php

declare(strict_types=1);

namespace ComplexPatient\Rest;

use ComplexPatient\Activation;

/**
 * Local development schema repair for the Complex Patient plugin.
 *
 * Syncing PHP files does not re-run WordPress activation hooks. This endpoint
 * creates any missing tables (for example paper_backup after an upgrade).
 */
final class SchemaController
{
    public const NAMESPACE = 'complex-patient/v1';

    public function registerRoutes(): void
    {
        register_rest_route(
            self::NAMESPACE,
            '/system/schema',
            [
                [
                    'methods'             => 'GET',
                    'callback'            => [$this, 'handleStatus'],
                    'permission_callback' => [$this, 'localRepairPermission'],
                ],
            ]
        );

        register_rest_route(
            self::NAMESPACE,
            '/system/schema/repair',
            [
                [
                    'methods'             => 'POST',
                    'callback'            => [$this, 'handleRepair'],
                    'permission_callback' => [$this, 'localRepairPermission'],
                ],
            ]
        );
    }

    /**
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleStatus()
    {
        global $wpdb;

        $tables = Activation::getSchemaStatus($wpdb);

        return new \WP_REST_Response(
            [
                'ok'     => ! in_array(false, $tables, true),
                'tables' => $tables,
            ],
            200
        );
    }

    /**
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleRepair()
    {
        global $wpdb;

        $repaired = Activation::repairMissingTables($wpdb);
        $tables   = Activation::getSchemaStatus($wpdb);

        return new \WP_REST_Response(
            [
                'ok'       => ! in_array(false, $tables, true),
                'repaired' => $repaired,
                'tables'   => $tables,
            ],
            200
        );
    }

    /**
     * @return bool|\WP_Error
     */
    public function localRepairPermission()
    {
        if ($this->isLocalRepairAllowed()) {
            return true;
        }

        return new \WP_Error(
            'complex_patient_schema_repair_forbidden',
            'Schema repair is only available on local WordPress Studio or from server loopback.',
            ['status' => 403]
        );
    }

    private function isLocalRepairAllowed(): bool
    {
        if (defined('COMPLEX_PATIENT_ALLOW_SCHEMA_REPAIR') && COMPLEX_PATIENT_ALLOW_SCHEMA_REPAIR) {
            return true;
        }

        if (defined('COMPLEX_PATIENT_SCHEMA_REPAIR_KEY') && '' !== COMPLEX_PATIENT_SCHEMA_REPAIR_KEY) {
            $provided = isset($_SERVER['HTTP_X_COMPLEX_PATIENT_SCHEMA_REPAIR_KEY'])
                ? (string) $_SERVER['HTTP_X_COMPLEX_PATIENT_SCHEMA_REPAIR_KEY']
                : '';
            if (hash_equals((string) COMPLEX_PATIENT_SCHEMA_REPAIR_KEY, $provided)) {
                return true;
            }
        }

        if (defined('WP_DEBUG') && WP_DEBUG) {
            return true;
        }

        $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        if (in_array($remote, array('127.0.0.1', '::1'), true)) {
            return true;
        }

        $host = isset($_SERVER['HTTP_HOST']) ? strtolower((string) $_SERVER['HTTP_HOST']) : '';

        return in_array($host, array('localhost:8881', '127.0.0.1:8881'), true);
    }
}
