<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

use ComplexPatient\DuplicateVaultException;
use ComplexPatient\VaultRepository;
use PHPUnit\Framework\TestCase;

/**
 * Verifies the wpdb-backed vault repository.
 *
 * Covers:
 *  - 4.4 reads/writes are scoped to the caller's wp_user_id.
 *  - 4.6 only the blind envelope (iv, auth_tag, ciphertext) and sync_version
 *        are returned; plaintext is never processed.
 *  - 9.6 a UNIQUE KEY violation on (wp_user_id, vault_type) is rejected with a
 *        duplicate-identifying error and the existing row is preserved.
 */
final class VaultRepositoryTest extends TestCase
{
    private InMemoryVaultWpdb $wpdb;
    private VaultRepository $repo;

    protected function setUp(): void
    {
        $this->wpdb = new InMemoryVaultWpdb();
        $this->repo = new VaultRepository($this->wpdb);
    }

    public function testFindReturnsNullWhenNoRowExists(): void
    {
        // Requirement 6.7 support: no stored data → null (controller maps to 404).
        $this->assertNull($this->repo->find(42, 'medications'));
    }

    public function testInsertThenFindReturnsOnlyBlindEnvelopeAndVersion(): void
    {
        $this->repo->insert(42, 'medications', 'iv-aaa', 'tag-bbb', 'cipher-ccc', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:01');

        $blob = $this->repo->find(42, 'medications');

        // Requirement 4.6: exactly the blind fields are returned, nothing else.
        $this->assertSame(
            ['sync_version', 'iv', 'auth_tag', 'ciphertext'],
            array_keys($blob)
        );
        $this->assertSame(1, $blob['sync_version']);
        $this->assertSame('iv-aaa', $blob['iv']);
        $this->assertSame('tag-bbb', $blob['auth_tag']);
        $this->assertSame('cipher-ccc', $blob['ciphertext']);
    }

    public function testFindIsScopedToUserId(): void
    {
        // Requirement 4.4: user 42 stores a blob; user 99 must not see it.
        $this->repo->insert(42, 'medications', 'iv', 'tag', 'cipher', 1, null, '2026-01-01 00:00:00');

        $this->assertNotNull($this->repo->find(42, 'medications'));
        $this->assertNull($this->repo->find(99, 'medications'));
    }

    public function testFindIsScopedToVaultType(): void
    {
        $this->repo->insert(42, 'medications', 'iv', 'tag', 'cipher', 1, null, '2026-01-01 00:00:00');

        $this->assertNotNull($this->repo->find(42, 'medications'));
        $this->assertNull($this->repo->find(42, 'symptoms'));
    }

    public function testSameVaultTypeIsIsolatedAcrossUsers(): void
    {
        // Requirement 4.4: identical vault_type for two users are distinct rows.
        $this->repo->insert(1, 'medications', 'iv-1', 'tag-1', 'cipher-1', 1, null, '2026-01-01 00:00:00');
        $this->repo->insert(2, 'medications', 'iv-2', 'tag-2', 'cipher-2', 1, null, '2026-01-01 00:00:00');

        $this->assertSame('cipher-1', $this->repo->find(1, 'medications')['ciphertext']);
        $this->assertSame('cipher-2', $this->repo->find(2, 'medications')['ciphertext']);
    }

    public function testInsertRejectsDuplicateUserVaultCombination(): void
    {
        // Requirement 9.6: second insert for the same (user, vault_type) is rejected.
        $this->repo->insert(42, 'medications', 'iv-orig', 'tag-orig', 'cipher-orig', 1, null, '2026-01-01 00:00:00');

        try {
            $this->repo->insert(42, 'medications', 'iv-new', 'tag-new', 'cipher-new', 1, null, '2026-02-02 00:00:00');
            $this->fail('Expected a DuplicateVaultException on the conflicting insert.');
        } catch (DuplicateVaultException $e) {
            // Error identifies the duplicate (wp_user_id, vault_type) combination.
            $this->assertSame(42, $e->wpUserId);
            $this->assertSame('medications', $e->vaultType);
            $this->assertStringContainsString('42', $e->getMessage());
            $this->assertStringContainsString('medications', $e->getMessage());
        }
    }

    public function testDuplicateInsertPreservesExistingRowUnchanged(): void
    {
        // Requirement 9.6: the existing stored row is preserved unchanged.
        $this->repo->insert(42, 'medications', 'iv-orig', 'tag-orig', 'cipher-orig', 1, null, '2026-01-01 00:00:00');

        try {
            $this->repo->insert(42, 'medications', 'iv-new', 'tag-new', 'cipher-new', 7, null, '2026-02-02 00:00:00');
        } catch (DuplicateVaultException) {
            // expected
        }

        $blob = $this->repo->find(42, 'medications');
        $this->assertSame('iv-orig', $blob['iv']);
        $this->assertSame('tag-orig', $blob['auth_tag']);
        $this->assertSame('cipher-orig', $blob['ciphertext']);
        $this->assertSame(1, $blob['sync_version']);
    }

    public function testUpdateChangesEnvelopeAndVersion(): void
    {
        $this->repo->insert(42, 'medications', 'iv-1', 'tag-1', 'cipher-1', 1, null, '2026-01-01 00:00:00');

        $affected = $this->repo->update(42, 'medications', 'iv-2', 'tag-2', 'cipher-2', 2, '2026-03-03 00:00:00', '2026-03-03 00:00:01');

        $this->assertSame(1, $affected);
        $blob = $this->repo->find(42, 'medications');
        $this->assertSame('iv-2', $blob['iv']);
        $this->assertSame('tag-2', $blob['auth_tag']);
        $this->assertSame('cipher-2', $blob['ciphertext']);
        $this->assertSame(2, $blob['sync_version']);
    }

    public function testUpdateReturnsZeroWhenNoMatchingRow(): void
    {
        // No row for this pair → nothing updated (controller treats as not-found).
        $affected = $this->repo->update(42, 'medications', 'iv', 'tag', 'cipher', 2, null, '2026-01-01 00:00:00');

        $this->assertSame(0, $affected);
        $this->assertNull($this->repo->find(42, 'medications'));
    }

    public function testUpdateIsScopedToUserId(): void
    {
        // Requirement 4.4: user 99 cannot overwrite user 42's blob.
        $this->repo->insert(42, 'medications', 'iv-42', 'tag-42', 'cipher-42', 1, null, '2026-01-01 00:00:00');

        $affected = $this->repo->update(99, 'medications', 'iv-evil', 'tag-evil', 'cipher-evil', 2, null, '2026-01-01 00:00:00');

        $this->assertSame(0, $affected);
        $blob = $this->repo->find(42, 'medications');
        $this->assertSame('cipher-42', $blob['ciphertext']);
        $this->assertSame(1, $blob['sync_version']);
    }

    public function testInsertSurfacesNonDuplicateDatabaseError(): void
    {
        $this->wpdb->forceGenericError = true;

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Failed to insert vault blob');

        $this->repo->insert(42, 'medications', 'iv', 'tag', 'cipher', 1, null, '2026-01-01 00:00:00');
    }

    public function testUpdateSurfacesDatabaseError(): void
    {
        $this->repo->insert(42, 'medications', 'iv', 'tag', 'cipher', 1, null, '2026-01-01 00:00:00');
        $this->wpdb->forceGenericError = true;

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Failed to update vault blob');

        $this->repo->update(42, 'medications', 'iv-2', 'tag-2', 'cipher-2', 2, null, '2026-01-01 00:00:00');
    }
}
