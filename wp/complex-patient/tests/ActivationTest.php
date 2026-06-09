<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

use ComplexPatient\Activation;
use PHPUnit\Framework\TestCase;

/**
 * Verifies the vault schema definition and activation halt behavior.
 *
 * Covers Requirement 9: 9.1 (idempotent dbDelta create), 9.2 (halt + no
 * partial table on failure), 9.3 (columns + auto-increment PK), 9.4 (LONGBLOB
 * ciphertext), 9.5 (UNIQUE KEY on wp_user_id, vault_type).
 */
final class ActivationTest extends TestCase
{
    public function testSchemaDefinesAllRequiredColumns(): void
    {
        $sql = Activation::buildSchemaSql('wp_complex_patient_vault');

        // Requirement 9.3: every required column is present.
        foreach (['id', 'wp_user_id', 'vault_type', 'iv', 'auth_tag', 'ciphertext', 'sync_version', 'client_updated_at', 'server_updated_at'] as $column) {
            $this->assertMatchesRegularExpression(
                '/\b' . preg_quote($column, '/') . '\b/',
                $sql,
                "Schema is missing column: {$column}"
            );
        }
    }

    public function testIdIsAutoIncrementingPrimaryKey(): void
    {
        $sql = Activation::buildSchemaSql('wp_complex_patient_vault');

        // Requirement 9.3: id is the auto-incrementing primary key.
        $this->assertMatchesRegularExpression('/id\s+BIGINT\(20\)\s+UNSIGNED\s+NOT\s+NULL\s+AUTO_INCREMENT/i', $sql);
        $this->assertMatchesRegularExpression('/PRIMARY\s+KEY\s+\(id\)/i', $sql);
    }

    public function testCiphertextIsLongblob(): void
    {
        $sql = Activation::buildSchemaSql('wp_complex_patient_vault');

        // Requirement 9.4: ciphertext column is LONGBLOB.
        $this->assertMatchesRegularExpression('/ciphertext\s+LONGBLOB\s+NOT\s+NULL/i', $sql);
    }

    public function testUniqueKeyOnUserAndVaultType(): void
    {
        $sql = Activation::buildSchemaSql('wp_complex_patient_vault');

        // Requirement 9.5: UNIQUE KEY on (wp_user_id, vault_type).
        $this->assertMatchesRegularExpression('/UNIQUE\s+KEY\s+\w+\s+\(wp_user_id,\s*vault_type\)/i', $sql);
    }

    public function testSyncVersionDefaultsToOne(): void
    {
        $sql = Activation::buildSchemaSql('wp_complex_patient_vault');

        $this->assertMatchesRegularExpression('/sync_version\s+BIGINT\(20\)\s+UNSIGNED\s+NOT\s+NULL\s+DEFAULT\s+1/i', $sql);
    }

    public function testCharsetCollateIsAppended(): void
    {
        $sql = Activation::buildSchemaSql('wp_complex_patient_vault', 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');

        $this->assertStringContainsString('DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', $sql);
    }

    public function testSchemaIsDbDeltaCompatible(): void
    {
        $sql = Activation::buildSchemaSql('wp_complex_patient_vault');

        // dbDelta requires two spaces between PRIMARY KEY and the definition.
        $this->assertStringContainsString('PRIMARY KEY  (id)', $sql);
        // Must be a CREATE TABLE statement (dbDelta create-if-absent, Req 9.1).
        $this->assertStringStartsWith('CREATE TABLE wp_complex_patient_vault', $sql);
    }

    public function testActivateSucceedsWhenTableIsCreated(): void
    {
        $wpdb = new FakeWpdb();
        $wpdb->tableExistsAfterDbDelta = true;
        $GLOBALS['wpdb'] = $wpdb;

        Activation::activate();

        // Requirement 9.1: dbDelta is invoked to create the table.
        $this->assertNotEmpty($wpdb->dbDeltaCalls);
        $this->assertStringContainsString('wp_complex_patient_vault', $wpdb->dbDeltaCalls[0]);
        // No partial-table cleanup needed on success.
        $this->assertSame([], $wpdb->droppedTables);
    }

    public function testActivateHaltsAndDropsPartialTableOnFailure(): void
    {
        $wpdb = new FakeWpdb();
        $wpdb->tableExistsAfterDbDelta = false; // simulate creation failure
        $wpdb->last_error = 'disk full';
        $GLOBALS['wpdb'] = $wpdb;

        // Requirement 9.2: activation halts with an error.
        try {
            Activation::activate();
            $this->fail('Expected activation to halt with an exception.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('failed to create the vault table', $e->getMessage());
            $this->assertStringContainsString('disk full', $e->getMessage());
        }

        // Requirement 9.2: leave no partial table behind.
        $this->assertContains('wp_complex_patient_vault', $wpdb->droppedTables);
    }
}
