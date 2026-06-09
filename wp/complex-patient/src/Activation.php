<?php

declare(strict_types=1);

namespace ComplexPatient;

/**
 * Plugin activation: creates the vault storage schema via dbDelta.
 *
 * Implements Requirement 9 (Vault Storage Schema):
 *  - 9.1 idempotent table creation via dbDelta (create only if absent).
 *  - 9.2 halt activation with an error and leave no partial table on failure.
 *  - 9.3 columns id, wp_user_id, vault_type, iv, auth_tag, ciphertext,
 *        sync_version, client_updated_at, server_updated_at; id is the
 *        auto-incrementing primary key.
 *  - 9.4 ciphertext defined as LONGBLOB.
 *  - 9.5 UNIQUE KEY on (wp_user_id, vault_type).
 */
final class Activation
{
    /**
     * Unprefixed base name of the vault table.
     */
    public const TABLE_BASENAME = 'complex_patient_vault';

    /**
     * Build the CREATE TABLE statement for the vault table.
     *
     * This is a pure function (no WordPress dependencies) so the schema can be
     * asserted in isolation. The statement is dbDelta-compatible: two spaces
     * after PRIMARY KEY and field definitions on their own lines.
     *
     * @param string $tableName      Fully prefixed table name (e.g. wp_complex_patient_vault).
     * @param string $charsetCollate Result of wpdb::get_charset_collate(), may be empty.
     */
    public static function buildSchemaSql(string $tableName, string $charsetCollate = ''): string
    {
        $suffix = '' === $charsetCollate ? '' : ' ' . $charsetCollate;

        return "CREATE TABLE {$tableName} (
  id                BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  wp_user_id        BIGINT(20) UNSIGNED NOT NULL,
  vault_type        VARCHAR(64) NOT NULL,
  iv                VARCHAR(32) NOT NULL,
  auth_tag          VARCHAR(32) NOT NULL,
  ciphertext        LONGBLOB NOT NULL,
  sync_version      BIGINT(20) UNSIGNED NOT NULL DEFAULT 1,
  client_updated_at DATETIME NULL,
  server_updated_at DATETIME NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY uniq_user_vault (wp_user_id, vault_type)
){$suffix};";
    }

    /**
     * Resolve the fully prefixed vault table name from the global $wpdb.
     */
    public static function tableName(\wpdb $wpdb): string
    {
        return $wpdb->prefix . self::TABLE_BASENAME;
    }

    /**
     * Plugin activation callback. Creates the vault table idempotently.
     *
     * On creation failure the activation is halted: the error is surfaced and
     * no partial table is left behind.
     *
     * @throws \RuntimeException When the table cannot be created.
     */
    public static function activate(): void
    {
        global $wpdb;

        if (! function_exists('dbDelta')) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        }

        $tableName = self::tableName($wpdb);
        $sql       = self::buildSchemaSql($tableName, $wpdb->get_charset_collate());

        // dbDelta creates the table only if it does not already exist and
        // applies non-destructive alterations otherwise (Requirement 9.1).
        dbDelta($sql);

        // Verify the table exists after dbDelta (Requirement 9.2). If creation
        // failed, drop any partial remnant and halt activation with an error.
        if (! self::tableExists($wpdb, $tableName)) {
            self::dropTable($wpdb, $tableName);

            $message = sprintf(
                'The Complex Patient: failed to create the vault table "%s". %s',
                $tableName,
                '' !== (string) $wpdb->last_error ? $wpdb->last_error : 'Unknown database error.'
            );

            if (function_exists('wp_die')) {
                wp_die(esc_html($message));
            }

            throw new \RuntimeException($message);
        }
    }

    /**
     * Determine whether the given table currently exists.
     */
    private static function tableExists(\wpdb $wpdb, string $tableName): bool
    {
        $found = $wpdb->get_var(
            $wpdb->prepare('SHOW TABLES LIKE %s', $tableName)
        );

        return $found === $tableName;
    }

    /**
     * Drop the table, removing any partially created remnant.
     */
    private static function dropTable(\wpdb $wpdb, string $tableName): void
    {
        // Table identifiers cannot be parameterized; the name is composed from
        // the trusted wpdb prefix plus a fixed constant, so it is safe here.
        $wpdb->query("DROP TABLE IF EXISTS {$tableName}");
    }
}
