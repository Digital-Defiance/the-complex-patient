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
     * Unprefixed base name of the per-user KDF material table.
     */
    public const KDF_TABLE_BASENAME = 'complex_patient_kdf';

    /**
     * Unprefixed base name of the device push registration table.
     */
    public const DEVICE_TABLE_BASENAME = 'complex_patient_device';

    /**
     * Unprefixed base name of the paper backup envelope table.
     */
    public const PAPER_BACKUP_TABLE_BASENAME = 'complex_patient_paper_backup';

    /**
     * Build the CREATE TABLE statement for the vault table.
     *
     * This is a pure function (no WordPress dependencies) so the schema can be
     * asserted in isolation. The statement is dbDelta-compatible: two spaces
     * after PRIMARY KEY, field types in lowercase, and field definitions on
     * their own lines.
     *
     * @param string $tableName      Fully prefixed table name (e.g. wp_complex_patient_vault).
     * @param string $charsetCollate Result of wpdb::get_charset_collate(), may be empty.
     */
    public static function buildSchemaSql(string $tableName, string $charsetCollate = ''): string
    {
        $suffix = '' === $charsetCollate ? '' : ' ' . $charsetCollate;

        return "CREATE TABLE {$tableName} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  wp_user_id bigint(20) unsigned NOT NULL,
  vault_type varchar(64) NOT NULL,
  iv varchar(32) NOT NULL,
  auth_tag varchar(32) NOT NULL,
  ciphertext longblob NOT NULL,
  sync_version bigint(20) unsigned NOT NULL DEFAULT 1,
  client_updated_at datetime DEFAULT NULL,
  server_updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY  (id),
  UNIQUE KEY uniq_user_vault (wp_user_id, vault_type)
){$suffix};";
    }

    /**
     * Build the CREATE TABLE statement for the KDF material table.
     *
     * Stores the non-secret salt and KDF parameters so every device for a
     * WordPress user derives the same KEK from the Master_Passphrase.
     *
     * @param string $tableName      Fully prefixed table name.
     * @param string $charsetCollate Result of wpdb::get_charset_collate(), may be empty.
     */
    public static function buildKdfSchemaSql(string $tableName, string $charsetCollate = ''): string
    {
        $suffix = '' === $charsetCollate ? '' : ' ' . $charsetCollate;

        return "CREATE TABLE {$tableName} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  wp_user_id bigint(20) unsigned NOT NULL,
  salt_base64 varchar(64) NOT NULL,
  kdf_params_json text NOT NULL,
  server_updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY  (id),
  UNIQUE KEY uniq_user (wp_user_id)
){$suffix};";
    }

    /**
     * Build the CREATE TABLE statement for the device registration table.
     *
     * @param string $tableName      Fully prefixed table name.
     * @param string $charsetCollate Result of wpdb::get_charset_collate(), may be empty.
     */
    public static function buildDeviceSchemaSql(string $tableName, string $charsetCollate = ''): string
    {
        $suffix = '' === $charsetCollate ? '' : ' ' . $charsetCollate;

        return "CREATE TABLE {$tableName} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  wp_user_id bigint(20) unsigned NOT NULL,
  device_id varchar(64) NOT NULL,
  platform varchar(16) NOT NULL,
  push_token varchar(512) NOT NULL,
  push_provider varchar(32) NOT NULL,
  last_seen_at datetime NOT NULL,
  server_updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY  (id),
  UNIQUE KEY uniq_user_device (wp_user_id, device_id)
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
     * Resolve the fully prefixed KDF material table name from the global $wpdb.
     */
    public static function kdfTableName(\wpdb $wpdb): string
    {
        return $wpdb->prefix . self::KDF_TABLE_BASENAME;
    }

    /**
     * Build the CREATE TABLE statement for the paper backup table.
     *
     * Stores only opaque AES-GCM envelopes wrapping the vault KEK. The mnemonic
     * never crosses this boundary and no system recovery key exists server-side.
     *
     * @param string $tableName      Fully prefixed table name.
     * @param string $charsetCollate Result of wpdb::get_charset_collate(), may be empty.
     */
    public static function buildPaperBackupSchemaSql(string $tableName, string $charsetCollate = ''): string
    {
        $suffix = '' === $charsetCollate ? '' : ' ' . $charsetCollate;

        return "CREATE TABLE {$tableName} (
  backup_id varchar(36) NOT NULL,
  wp_user_id bigint(20) unsigned NOT NULL,
  label varchar(128) DEFAULT NULL,
  iv varchar(32) NOT NULL,
  auth_tag varchar(32) NOT NULL,
  ciphertext longblob NOT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (backup_id),
  KEY idx_user (wp_user_id)
){$suffix};";
    }

    /**
     * Resolve the fully prefixed device registration table name.
     */
    public static function deviceTableName(\wpdb $wpdb): string
    {
        return $wpdb->prefix . self::DEVICE_TABLE_BASENAME;
    }

    /**
     * Resolve the fully prefixed paper backup table name.
     */
    public static function paperBackupTableName(\wpdb $wpdb): string
    {
        return $wpdb->prefix . self::PAPER_BACKUP_TABLE_BASENAME;
    }

    /**
     * Plugin activation callback. Creates the vault and KDF tables idempotently.
     *
     * On creation failure the activation is halted: the error is surfaced and
     * no partial table is left behind.
     *
     * @throws \RuntimeException When a table cannot be created.
     */
    public static function activate(): void
    {
        self::installTables(true);
    }

    /**
     * Ensure schema exists on every plugin load (covers Studio re-activations
     * where dbDelta failed silently and upgrades that add new tables).
     */
    public static function ensureSchema(): void
    {
        try {
            self::installTables(false);
        } catch (\Throwable $exception) {
            if (function_exists('error_log')) {
                error_log('[Complex Patient] ensureSchema failed: ' . $exception->getMessage());
            }
        }
    }

    /**
     * @throws \RuntimeException When $haltOnFailure is true and a table cannot be created.
     */
    private static function installTables(bool $haltOnFailure): void
    {
        global $wpdb;

        if (! function_exists('dbDelta')) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        }

        $charsetCollate = $wpdb->get_charset_collate();
        $tables         = [
            self::tableName($wpdb)             => self::buildSchemaSql(self::tableName($wpdb), $charsetCollate),
            self::kdfTableName($wpdb)          => self::buildKdfSchemaSql(self::kdfTableName($wpdb), $charsetCollate),
            self::deviceTableName($wpdb)       => self::buildDeviceSchemaSql(self::deviceTableName($wpdb), $charsetCollate),
            self::paperBackupTableName($wpdb)  => self::buildPaperBackupSchemaSql(self::paperBackupTableName($wpdb), $charsetCollate),
        ];

        foreach ($tables as $tableName => $sql) {
            try {
                self::ensureTable($wpdb, $tableName, $sql, $haltOnFailure);
            } catch (\Throwable $exception) {
                if ($haltOnFailure) {
                    throw $exception;
                }

                if (function_exists('error_log')) {
                    error_log(
                        '[Complex Patient] ensureSchema failed for '
                        . $tableName
                        . ': '
                        . $exception->getMessage()
                    );
                }
            }
        }
    }

    /**
     * Create or upgrade a single table, with a direct CREATE fallback when
     * dbDelta fails silently (common with non-lowercase field types).
     *
     * @throws \RuntimeException When $haltOnFailure is true and creation fails.
     */
    private static function ensureTable(\wpdb $wpdb, string $tableName, string $sql, bool $haltOnFailure): void
    {
        dbDelta($sql);

        if (! self::tableExists($wpdb, $tableName)) {
            // dbDelta can fail without surfacing an error; attempt a direct CREATE.
            $wpdb->query($sql);
        }

        if (self::tableExists($wpdb, $tableName)) {
            return;
        }

        self::dropTable($wpdb, $tableName);

        $message = sprintf(
            'The Complex Patient: failed to create the table "%s". %s',
            $tableName,
            '' !== (string) $wpdb->last_error ? $wpdb->last_error : 'Unknown database error.'
        );

        if ($haltOnFailure) {
            if (function_exists('wp_die')) {
                wp_die(esc_html($message));
            }

            throw new \RuntimeException($message);
        }

        throw new \RuntimeException($message);
    }

    /**
     * Determine whether the given table currently exists.
     */
    public static function hasTable(\wpdb $wpdb, string $tableName): bool
    {
        return self::tableExists($wpdb, $tableName);
    }

    /**
     * Report which plugin tables are present in the database.
     *
     * @return array<string, bool>
     */
    public static function getSchemaStatus(\wpdb $wpdb): array
    {
        return [
            'vault'        => self::tableExists($wpdb, self::tableName($wpdb)),
            'kdf'          => self::tableExists($wpdb, self::kdfTableName($wpdb)),
            'device'       => self::tableExists($wpdb, self::deviceTableName($wpdb)),
            'paper_backup' => self::tableExists($wpdb, self::paperBackupTableName($wpdb)),
        ];
    }

    /**
     * Create any missing plugin tables. Safe to call after rsync deploys new PHP
     * without re-activating the plugin in wp-admin.
     *
     * @return array<string, string> short table key → present|created|failed|error
     */
    public static function repairMissingTables(\wpdb $wpdb): array
    {
        if (! function_exists('dbDelta')) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        }

        $charsetCollate = $wpdb->get_charset_collate();
        $tables         = [
            'vault'        => [self::tableName($wpdb), self::buildSchemaSql(self::tableName($wpdb), $charsetCollate)],
            'kdf'          => [self::kdfTableName($wpdb), self::buildKdfSchemaSql(self::kdfTableName($wpdb), $charsetCollate)],
            'device'       => [self::deviceTableName($wpdb), self::buildDeviceSchemaSql(self::deviceTableName($wpdb), $charsetCollate)],
            'paper_backup' => [self::paperBackupTableName($wpdb), self::buildPaperBackupSchemaSql(self::paperBackupTableName($wpdb), $charsetCollate)],
        ];

        $report = [];

        foreach ($tables as $key => [$tableName, $sql]) {
            if (self::tableExists($wpdb, $tableName)) {
                $report[$key] = 'present';
                continue;
            }

            try {
                self::ensureTable($wpdb, $tableName, $sql, false);
                $report[$key] = self::tableExists($wpdb, $tableName) ? 'created' : 'failed';
            } catch (\Throwable $exception) {
                if (function_exists('error_log')) {
                    error_log(
                        '[Complex Patient] repairMissingTables failed for '
                        . $tableName
                        . ': '
                        . $exception->getMessage()
                    );
                }
                $report[$key] = 'error';
            }
        }

        return $report;
    }

    /**
     * Determine whether the given table currently exists.
     */
    private static function tableExists(\wpdb $wpdb, string $tableName): bool
    {
        $found = $wpdb->get_var(
            $wpdb->prepare('SHOW TABLES LIKE %s', $tableName)
        );

        if (! is_string($found) || '' === $found) {
            return false;
        }

        return $found === $tableName || strcasecmp($found, $tableName) === 0;
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
