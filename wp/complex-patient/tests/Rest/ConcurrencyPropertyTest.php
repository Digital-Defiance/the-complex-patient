<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\Rest\VaultController;
use ComplexPatient\Tests\InMemoryVaultWpdb;
use ComplexPatient\VaultRepository;
use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Response;
use WP_REST_Request;

/**
 * Property-based test for optimistic concurrency control.
 *
 * Property 13: Optimistic concurrency correctness
 * (Validates: Requirements 7.2, 7.5)
 *
 * For any stored partition at version V and any supplied version S:
 *  - if S != V, the POST is rejected with HTTP 409, the response carries the
 *    current stored version V, and the stored blob and version are left
 *    byte-for-byte unchanged (Requirement 7.2);
 *  - if S == V, the POST is accepted and the stored version becomes exactly
 *    V + 1 (Requirement 7.5).
 *
 * No PHP property-testing framework (a fast-check / Hypothesis analogue) is
 * available in this project, so the property is exercised as a seeded
 * generative test: a deterministic PRNG produces a wide range of
 * (storedVersion, suppliedVersion, blob contents) tuples — including stale,
 * equal, and ahead cases — and the invariant is asserted for every tuple. The
 * fixed seed makes any counterexample reproducible.
 */
final class ConcurrencyPropertyTest extends TestCase
{
    /** Deterministic seed so a failing tuple is reproducible. */
    private const SEED = 0x5EED_C0DE;

    /** Number of generated tuples to exercise. */
    private const ITERATIONS = 2000;

    protected function setUp(): void
    {
        // Authenticated user with a pinned server clock (mirrors the
        // controller test conventions).
        $GLOBALS['complex_patient_current_user_id'] = 42;
        $GLOBALS['complex_patient_current_time']    = '2026-01-01 12:00:00';
    }

    protected function tearDown(): void
    {
        unset(
            $GLOBALS['complex_patient_current_user_id'],
            $GLOBALS['complex_patient_current_time']
        );
        parent::tearDown();
    }

    /**
     * **Validates: Requirements 7.2, 7.5**
     */
    public function testOptimisticConcurrencyCorrectnessAcrossGeneratedTuples(): void
    {
        mt_srand(self::SEED);

        $vaultTypes = VaultController::VAULT_TYPES;

        for ($i = 0; $i < self::ITERATIONS; $i++) {
            // Generate a stored version V. 0 models the "no stored blob"
            // case (an initial write); >= 1 models an existing blob.
            $storedVersion = mt_rand(0, 50);

            // Generate a supplied version S biased to produce a healthy mix of
            // equal, stale (below), and ahead (above) cases.
            $suppliedVersion = $this->generateSuppliedVersion($storedVersion);

            $vaultType = $vaultTypes[mt_rand(0, count($vaultTypes) - 1)];

            // Fresh storage per tuple so cases are independent.
            $wpdb       = new InMemoryVaultWpdb();
            $repo       = new VaultRepository($wpdb);
            $controller = new VaultController($repo, new AuthMiddleware());

            $storedIv     = $this->randomToken('iv');
            $storedTag    = $this->randomToken('tag');
            $storedCipher = $this->randomToken('cipher');

            $rowKey = '42|' . $vaultType;

            if ($storedVersion > 0) {
                $repo->insert(
                    42,
                    $vaultType,
                    $storedIv,
                    $storedTag,
                    $storedCipher,
                    $storedVersion,
                    null,
                    '2026-01-01 00:00:00'
                );
                $before = $wpdb->rows[$rowKey];
            } else {
                // No stored blob: stored version is conceptually 0.
                $this->assertArrayNotHasKey($rowKey, $wpdb->rows);
                $before = null;
            }

            $response = $controller->handlePost(new WP_REST_Request([
                'vault_type'   => $vaultType,
                'iv'           => $this->randomToken('iv-new'),
                'auth_tag'     => $this->randomToken('tag-new'),
                'ciphertext'   => $this->randomToken('cipher-new'),
                'sync_version' => $suppliedVersion,
            ]));

            $context = sprintf(
                'iteration %d (vault_type=%s, storedVersion=%d, suppliedVersion=%d)',
                $i,
                $vaultType,
                $storedVersion,
                $suppliedVersion
            );

            if ($suppliedVersion === $storedVersion) {
                // Requirement 7.5: accepted, stored version becomes V + 1.
                $this->assertInstanceOf(WP_REST_Response::class, $response, $context);
                $this->assertSame(200, $response->get_status(), $context);
                $this->assertSame(
                    ['sync_version' => $storedVersion + 1],
                    $response->get_data(),
                    $context
                );
                $this->assertSame(
                    $storedVersion + 1,
                    $wpdb->rows[$rowKey]['sync_version'],
                    $context
                );
            } else {
                // Requirement 7.2: rejected with 409 carrying current version V,
                // and the stored blob + version are left unchanged.
                $this->assertInstanceOf(WP_Error::class, $response, $context);
                $this->assertSame(
                    'complex_patient_sync_version_conflict',
                    $response->get_error_code(),
                    $context
                );

                $data = $response->get_error_data();
                $this->assertSame(409, $data['status'], $context);
                $this->assertSame($storedVersion, $data['sync_version'], $context);

                if (null === $before) {
                    // No blob existed and none was created.
                    $this->assertArrayNotHasKey($rowKey, $wpdb->rows, $context);
                } else {
                    // Stored blob is byte-for-byte unchanged.
                    $this->assertSame($before, $wpdb->rows[$rowKey], $context);
                    $this->assertSame($storedVersion, $wpdb->rows[$rowKey]['sync_version'], $context);
                    $this->assertSame($storedIv, $wpdb->rows[$rowKey]['iv'], $context);
                    $this->assertSame($storedTag, $wpdb->rows[$rowKey]['auth_tag'], $context);
                    $this->assertSame($storedCipher, $wpdb->rows[$rowKey]['ciphertext'], $context);
                }
            }
        }
    }

    /**
     * Produce a supplied sync_version that yields a useful mix of equal, stale,
     * and ahead cases relative to the stored version, while staying a valid
     * non-negative integer (so the concurrency comparison — not input
     * validation — is what is under test).
     */
    private function generateSuppliedVersion(int $storedVersion): int
    {
        switch (mt_rand(0, 3)) {
            case 0:
                // Equal (accept) case.
                return $storedVersion;
            case 1:
                // Stale: strictly below the stored version (clamped at 0).
                return $storedVersion > 0 ? mt_rand(0, $storedVersion - 1) : 0;
            case 2:
                // Ahead: strictly above the stored version.
                return $storedVersion + mt_rand(1, 10);
            default:
                // Unconstrained non-negative integer.
                return mt_rand(0, 60);
        }
    }

    private function randomToken(string $prefix): string
    {
        return $prefix . '-' . dechex(mt_rand(0, PHP_INT_MAX));
    }
}
