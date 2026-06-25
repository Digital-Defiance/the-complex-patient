<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\Rest\VaultController;
use ComplexPatient\Tests\InMemoryVaultWpdb;
use ComplexPatient\VaultRepository;
use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Integration-style unit tests for the blind vault REST controller.
 *
 * Covers task 6.4 (Requirements 6.1–6.7, 4.7):
 *  - 6.5 routes registered on rest_api_init under the complex-patient/v1 ns.
 *  - 6.2 GET returns the blind envelope for a recognized vault_type / user.
 *  - 6.7 GET returns a 404 not-found indication when no blob exists.
 *  - 6.6 an unrecognized vault_type is rejected without touching storage.
 *  - 4.7 / 6.8 a POST missing a required encrypted field is rejected,
 *        identifying the field, and persists nothing.
 *  - 6.3 / 6.4 a valid POST persists the envelope, sets server_updated_at, and
 *        returns the resulting sync_version (1 on first write, +1 thereafter).
 *
 * (The deeper optimistic-concurrency / 409 behaviour of Requirement 7 is the
 * subject of task 6.5 and is not asserted here.)
 */
final class VaultControllerTest extends TestCase
{
    private InMemoryVaultWpdb $wpdb;
    private VaultRepository $repo;
    private VaultController $controller;

    protected function setUp(): void
    {
        $this->wpdb       = new InMemoryVaultWpdb();
        $this->repo       = new VaultRepository($this->wpdb);
        $this->controller = new VaultController($this->repo, new AuthMiddleware());

        // Default: an authenticated user with a pinned server clock.
        $GLOBALS['complex_patient_current_user_id'] = 42;
        $GLOBALS['complex_patient_current_time']    = '2026-01-01 12:00:00';
    }

    protected function tearDown(): void
    {
        unset(
            $GLOBALS['complex_patient_current_user_id'],
            $GLOBALS['complex_patient_auth_filter_result'],
            $GLOBALS['complex_patient_current_time'],
            $GLOBALS['complex_patient_registered_routes'],
            $GLOBALS['complex_patient_actions']
        );
        parent::tearDown();
    }

    /**
     * @param array<string,mixed> $params
     */
    private function request(array $params): WP_REST_Request
    {
        return new WP_REST_Request($params);
    }

    // --- Route registration (Requirements 6.1, 6.5) ---

    public function testRegisterBindsToRestApiInit(): void
    {
        $this->controller->register();

        $actions = $GLOBALS['complex_patient_actions']['rest_api_init'] ?? [];
        $this->assertCount(1, $actions);
        $this->assertSame([$this->controller, 'registerRoutes'], $actions[0]);
    }

    public function testRegisterRoutesRegistersNamespacedVaultRoute(): void
    {
        $this->controller->registerRoutes();

        $routes = $GLOBALS['complex_patient_registered_routes'] ?? [];
        $this->assertCount(1, $routes);

        $route = $routes[0];
        $this->assertSame('complex-patient/v1', $route['namespace']);
        $this->assertStringContainsString('/vault/', $route['route']);

        // Both GET and POST are registered with an auth permission_callback.
        $methods = array_map(static fn ($entry) => $entry['methods'], $route['args']);
        $this->assertContains('GET', $methods);
        $this->assertContains('POST', $methods);

        foreach ($route['args'] as $entry) {
            $this->assertArrayHasKey('permission_callback', $entry);
            $this->assertArrayHasKey('callback', $entry);
        }
    }

    // --- GET contract (Requirements 6.2, 6.6, 6.7) ---

    public function testGetReturnsStoredBlindEnvelope(): void
    {
        $this->repo->insert(42, 'medications', 'iv-x', 'tag-y', 'cipher-z', 3, null, '2026-01-01 00:00:00');

        $response = $this->controller->handleGet($this->request(['vault_type' => 'medications']));

        $this->assertInstanceOf(WP_REST_Response::class, $response);
        $this->assertSame(200, $response->get_status());
        $this->assertSame(
            ['sync_version' => 3, 'iv' => 'iv-x', 'auth_tag' => 'tag-y', 'ciphertext' => 'cipher-z'],
            $response->get_data()
        );
    }

    public function testGetReturnsNotFoundWhenNoBlobExists(): void
    {
        // Requirement 6.7: recognized vault_type, but no stored data → 404.
        $response = $this->controller->handleGet($this->request(['vault_type' => 'symptoms']));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_vault_not_found', $response->get_error_code());
        $this->assertSame(['status' => 404], $response->get_error_data());
    }

    public function testGetRejectsUnrecognizedVaultTypeWithoutReading(): void
    {
        // Requirement 6.6: unrecognized vault_type rejected, nothing read.
        $response = $this->controller->handleGet($this->request(['vault_type' => 'bogus']));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_unrecognized_vault_type', $response->get_error_code());
        $this->assertSame(400, $response->get_error_data()['status']);
    }

    public function testGetRejectsReservedVaultSubpathsWithoutReading(): void
    {
        foreach (['paper-backups', 'kdf-material'] as $reserved) {
            $response = $this->controller->handleGet($this->request(['vault_type' => $reserved]));

            $this->assertInstanceOf(WP_Error::class, $response, $reserved);
            $this->assertSame('complex_patient_unrecognized_vault_type', $response->get_error_code(), $reserved);
            $this->assertSame(400, $response->get_error_data()['status'], $reserved);
        }
    }

    public function testVaultRoutePatternExcludesReservedSubpaths(): void
    {
        $this->controller->registerRoutes();
        $route = $GLOBALS['complex_patient_registered_routes'][0]['route'] ?? '';

        $this->assertStringContainsString('paper-backups', $route);
        $this->assertStringContainsString('kdf-material', $route);
    }

    public function testGetIsScopedToAuthenticatedUser(): void
    {
        // User 7 stored a blob; the authenticated caller (42) must not see it.
        $this->repo->insert(7, 'medications', 'iv-7', 'tag-7', 'cipher-7', 1, null, '2026-01-01 00:00:00');

        $response = $this->controller->handleGet($this->request(['vault_type' => 'medications']));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_vault_not_found', $response->get_error_code());
    }

    // --- POST contract (Requirements 6.3, 6.4, 6.6, 4.7) ---

    public function testPostInitialWritePersistsAndSetsVersionToOne(): void
    {
        $response = $this->controller->handlePost($this->request([
            'vault_type' => 'medications',
            'iv'         => 'iv-1',
            'auth_tag'   => 'tag-1',
            'ciphertext' => 'cipher-1',
            'sync_version' => 0,
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $response);
        $this->assertSame(200, $response->get_status());
        $this->assertSame(['sync_version' => 1], $response->get_data());

        // Requirement 6.4: persisted with server_updated_at = server time.
        $row = $this->wpdb->rows['42|medications'];
        $this->assertSame('iv-1', $row['iv']);
        $this->assertSame('tag-1', $row['auth_tag']);
        $this->assertSame('cipher-1', $row['ciphertext']);
        $this->assertSame(1, $row['sync_version']);
        $this->assertSame('2026-01-01 12:00:00', $row['server_updated_at']);
    }

    public function testPostUpdateIncrementsStoredVersion(): void
    {
        $this->repo->insert(42, 'medications', 'iv-old', 'tag-old', 'cipher-old', 4, null, '2026-01-01 00:00:00');

        $response = $this->controller->handlePost($this->request([
            'vault_type' => 'medications',
            'iv'         => 'iv-new',
            'auth_tag'   => 'tag-new',
            'ciphertext' => 'cipher-new',
            'sync_version' => 4,
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $response);
        // Requirement 6.4: stored sync_version incremented by 1.
        $this->assertSame(['sync_version' => 5], $response->get_data());

        $row = $this->wpdb->rows['42|medications'];
        $this->assertSame('cipher-new', $row['ciphertext']);
        $this->assertSame(5, $row['sync_version']);
        $this->assertSame('2026-01-01 12:00:00', $row['server_updated_at']);
    }

    public function testPostPersistsClientUpdatedAtWhenProvided(): void
    {
        $this->controller->handlePost($this->request([
            'vault_type'        => 'symptoms',
            'iv'                => 'iv',
            'auth_tag'          => 'tag',
            'ciphertext'        => 'cipher',
            'client_updated_at' => '2025-12-31 23:59:59',
            'sync_version'      => 0,
        ]));

        $row = $this->wpdb->rows['42|symptoms'];
        $this->assertSame('2025-12-31 23:59:59', $row['client_updated_at']);
    }

    public function testPostRejectsUnrecognizedVaultTypeWithoutWriting(): void
    {
        // Requirement 6.6: unrecognized vault_type rejected, nothing persisted.
        $response = $this->controller->handlePost($this->request([
            'vault_type' => 'bogus',
            'iv'         => 'iv',
            'auth_tag'   => 'tag',
            'ciphertext' => 'cipher',
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_unrecognized_vault_type', $response->get_error_code());
        $this->assertSame([], $this->wpdb->rows);
    }

    /**
     * @dataProvider missingEnvelopeFieldProvider
     *
     * @param array<string,mixed> $params
     */
    public function testPostRejectsMissingEncryptedFieldPersistingNothing(array $params, string $expectedField): void
    {
        // Requirements 4.7 / 6.8: missing/empty required field → reject,
        // identify the field, persist nothing.
        $response = $this->controller->handlePost($this->request($params));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_missing_field', $response->get_error_code());

        $data = $response->get_error_data();
        $this->assertSame(400, $data['status']);
        $this->assertSame($expectedField, $data['field']);

        // Nothing was persisted on rejection.
        $this->assertSame([], $this->wpdb->rows);
    }

    /**
     * @return iterable<string, array{0: array<string,mixed>, 1: string}>
     */
    public static function missingEnvelopeFieldProvider(): iterable
    {
        $base = [
            'vault_type' => 'medications',
            'iv'         => 'iv',
            'auth_tag'   => 'tag',
            'ciphertext' => 'cipher',
        ];

        yield 'missing iv' => [array_diff_key($base, ['iv' => null]), 'iv'];
        yield 'missing auth_tag' => [array_diff_key($base, ['auth_tag' => null]), 'auth_tag'];
        yield 'missing ciphertext' => [array_diff_key($base, ['ciphertext' => null]), 'ciphertext'];

        yield 'empty iv' => [array_merge($base, ['iv' => '']), 'iv'];
        yield 'empty auth_tag' => [array_merge($base, ['auth_tag' => '']), 'auth_tag'];
        yield 'empty ciphertext' => [array_merge($base, ['ciphertext' => '']), 'ciphertext'];
    }

    public function testPostDoesNotMutateExistingRowWhenFieldMissing(): void
    {
        // Requirement 6.8: the existing stored blob is preserved on rejection.
        $this->repo->insert(42, 'medications', 'iv-keep', 'tag-keep', 'cipher-keep', 2, null, '2026-01-01 00:00:00');

        $this->controller->handlePost($this->request([
            'vault_type' => 'medications',
            'iv'         => 'iv-new',
            'auth_tag'   => 'tag-new',
            // ciphertext omitted
        ]));

        $row = $this->wpdb->rows['42|medications'];
        $this->assertSame('iv-keep', $row['iv']);
        $this->assertSame('cipher-keep', $row['ciphertext']);
        $this->assertSame(2, $row['sync_version']);
    }

    // --- Optimistic concurrency control (Requirements 7.1–7.6, 6.8) ---

    public function testPostInitialWriteRequiresSyncVersionZero(): void
    {
        // Requirement 7.4 / 7.1: with no stored blob the client must supply
        // sync_version 0 (overwriting nothing); the accepted write sets it to 1.
        $response = $this->controller->handlePost($this->request([
            'vault_type'   => 'medications',
            'iv'           => 'iv-1',
            'auth_tag'     => 'tag-1',
            'ciphertext'   => 'cipher-1',
            'sync_version' => 0,
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $response);
        $this->assertSame(['sync_version' => 1], $response->get_data());
        $this->assertSame(1, $this->wpdb->rows['42|medications']['sync_version']);
    }

    public function testPostEqualVersionIsAcceptedAndIncrementsByExactlyOne(): void
    {
        // Requirement 7.3 / 7.5: supplied version equals stored version → accept
        // and increment stored version by exactly 1.
        $this->repo->insert(42, 'medications', 'iv-old', 'tag-old', 'cipher-old', 4, null, '2026-01-01 00:00:00');

        $response = $this->controller->handlePost($this->request([
            'vault_type'   => 'medications',
            'iv'           => 'iv-new',
            'auth_tag'     => 'tag-new',
            'ciphertext'   => 'cipher-new',
            'sync_version' => 4,
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $response);
        $this->assertSame(['sync_version' => 5], $response->get_data());

        $row = $this->wpdb->rows['42|medications'];
        $this->assertSame('cipher-new', $row['ciphertext']);
        $this->assertSame(5, $row['sync_version']);
    }

    public function testPostStaleVersionIsRejectedWith409AndCurrentVersion(): void
    {
        // Requirement 7.2 / 6.8: a mismatched (stale) version → HTTP 409 Conflict
        // carrying the current stored sync_version; stored blob left unchanged.
        $this->repo->insert(42, 'medications', 'iv-keep', 'tag-keep', 'cipher-keep', 7, null, '2026-01-01 00:00:00');

        $response = $this->controller->handlePost($this->request([
            'vault_type'   => 'medications',
            'iv'           => 'iv-new',
            'auth_tag'     => 'tag-new',
            'ciphertext'   => 'cipher-new',
            'sync_version' => 5,
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_sync_version_conflict', $response->get_error_code());

        $data = $response->get_error_data();
        $this->assertSame(409, $data['status']);
        $this->assertSame(7, $data['sync_version']);

        // Stored blob and version are unchanged.
        $row = $this->wpdb->rows['42|medications'];
        $this->assertSame('iv-keep', $row['iv']);
        $this->assertSame('cipher-keep', $row['ciphertext']);
        $this->assertSame(7, $row['sync_version']);
    }

    public function testPostAheadVersionIsAlsoRejectedWith409(): void
    {
        // Requirement 7.2: any inequality (including a version ahead of stored)
        // is a conflict.
        $this->repo->insert(42, 'symptoms', 'iv', 'tag', 'cipher', 2, null, '2026-01-01 00:00:00');

        $response = $this->controller->handlePost($this->request([
            'vault_type'   => 'symptoms',
            'iv'           => 'iv-new',
            'auth_tag'     => 'tag-new',
            'ciphertext'   => 'cipher-new',
            'sync_version' => 3,
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(409, $response->get_error_data()['status']);
        $this->assertSame(2, $response->get_error_data()['sync_version']);
        $this->assertSame(2, $this->wpdb->rows['42|symptoms']['sync_version']);
    }

    public function testPostNonZeroVersionOnInitialWriteIsRejectedWith409(): void
    {
        // No stored blob is treated as version 0; supplying anything else is a
        // conflict and persists nothing (Requirements 7.1, 7.2).
        $response = $this->controller->handlePost($this->request([
            'vault_type'   => 'medications',
            'iv'           => 'iv',
            'auth_tag'     => 'tag',
            'ciphertext'   => 'cipher',
            'sync_version' => 1,
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(409, $response->get_error_data()['status']);
        $this->assertSame(0, $response->get_error_data()['sync_version']);
        $this->assertSame([], $this->wpdb->rows);
    }

    /**
     * @dataProvider invalidSyncVersionProvider
     *
     * @param mixed $value
     */
    public function testPostRejectsInvalidSyncVersionWithValidationError($value): void
    {
        // Requirement 7.6: missing or non-(non-negative-integer) sync_version →
        // validation error, stored data unchanged.
        $this->repo->insert(42, 'medications', 'iv-keep', 'tag-keep', 'cipher-keep', 3, null, '2026-01-01 00:00:00');

        $params = [
            'vault_type' => 'medications',
            'iv'         => 'iv-new',
            'auth_tag'   => 'tag-new',
            'ciphertext' => 'cipher-new',
        ];
        if ('__MISSING__' !== $value) {
            $params['sync_version'] = $value;
        }

        $response = $this->controller->handlePost($this->request($params));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_invalid_sync_version', $response->get_error_code());
        $this->assertSame(400, $response->get_error_data()['status']);

        // Stored blob and version untouched.
        $row = $this->wpdb->rows['42|medications'];
        $this->assertSame('cipher-keep', $row['ciphertext']);
        $this->assertSame(3, $row['sync_version']);
    }

    /**
     * @return iterable<string, array{0: mixed}>
     */
    public static function invalidSyncVersionProvider(): iterable
    {
        yield 'missing' => ['__MISSING__'];
        yield 'null' => [null];
        yield 'negative int' => [-1];
        yield 'negative string' => ['-3'];
        yield 'float' => [1.5];
        yield 'float string' => ['2.0'];
        yield 'non-numeric string' => ['abc'];
        yield 'empty string' => [''];
        yield 'whitespace padded' => [' 3 '];
        yield 'scientific notation' => ['1e3'];
        yield 'boolean true' => [true];
    }

    public function testPostInvalidSyncVersionOnInitialWritePersistsNothing(): void
    {
        // Requirement 7.6: invalid sync_version with no existing row persists
        // nothing.
        $response = $this->controller->handlePost($this->request([
            'vault_type' => 'medications',
            'iv'         => 'iv',
            'auth_tag'   => 'tag',
            'ciphertext' => 'cipher',
            // sync_version omitted
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_invalid_sync_version', $response->get_error_code());
        $this->assertSame([], $this->wpdb->rows);
    }

    public function testPostAcceptsCanonicalSyncVersionString(): void
    {
        // A canonical non-negative integer string is a valid sync_version.
        $this->repo->insert(42, 'medications', 'iv-old', 'tag-old', 'cipher-old', 2, null, '2026-01-01 00:00:00');

        $response = $this->controller->handlePost($this->request([
            'vault_type'   => 'medications',
            'iv'           => 'iv-new',
            'auth_tag'     => 'tag-new',
            'ciphertext'   => 'cipher-new',
            'sync_version' => '2',
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $response);
        $this->assertSame(['sync_version' => 3], $response->get_data());
    }

    // --- Auth integration (Requirements 4.3, 4.5) ---

    public function testGetRejectsAnonymousCallerWithoutReading(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 0;
        $this->repo->insert(42, 'medications', 'iv', 'tag', 'cipher', 1, null, '2026-01-01 00:00:00');

        $response = $this->controller->handleGet($this->request(['vault_type' => 'medications']));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(401, $response->get_error_data()['status']);
    }

    public function testPostRejectsAnonymousCallerWithoutWriting(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 0;

        $response = $this->controller->handlePost($this->request([
            'vault_type' => 'medications',
            'iv'         => 'iv',
            'auth_tag'   => 'tag',
            'ciphertext' => 'cipher',
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(401, $response->get_error_data()['status']);
        $this->assertSame([], $this->wpdb->rows);
    }
}
