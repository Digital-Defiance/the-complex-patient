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
 * End-to-end integration tests for the blind vault REST endpoints (task 6.6).
 *
 * Where {@see VaultControllerTest} unit-tests the controller handlers in
 * isolation by invoking handleGet()/handlePost() directly, this suite drives
 * requests through the *fully wired* request path exactly as WordPress would:
 *
 *   register routes  →  resolve the matching method entry  →  run its
 *   permission_callback (AuthMiddleware)  →  only on success invoke the
 *   callback (VaultController handler)  →  VaultRepository  →  InMemoryVaultWpdb
 *
 * Crucially this means the {@see AuthMiddleware} permission gate runs *before*
 * any handler, so an unauthenticated or cross-user request is rejected at the
 * boundary and the handler — and therefore any read or write — never executes.
 * The unit suite bypasses that gate; this suite asserts it.
 *
 * Requirements exercised through the integrated path:
 *  - 4.3 a missing/invalid credential is rejected at the permission gate; no
 *        read or write occurs.
 *  - 4.5 an authenticated user requesting another wp_user_id's vault is denied
 *        (HTTP 403) and the foreign blob is never returned.
 *  - 6.6 an unrecognized vault_type is rejected (HTTP 400) without touching
 *        storage.
 *  - 4.7 a POST missing a required encrypted field is rejected (HTTP 400),
 *        identifying the field, and persists nothing.
 *  - 6.7 GET for a recognized vault_type with no stored blob returns a 404
 *        not-found indication.
 *  - 6.2 / 6.3 the GET/POST success contract: a POST persists and returns the
 *        resulting sync_version, and a subsequent GET returns exactly the
 *        stored blind envelope.
 */
final class VaultEndpointIntegrationTest extends TestCase
{
    private InMemoryVaultWpdb $wpdb;
    private VaultRepository $repo;
    private VaultController $controller;

    /**
     * The route registration captured from register_rest_route(), used by the
     * dispatcher to resolve the per-method permission_callback + callback.
     *
     * @var array<string,mixed>
     */
    private array $route;

    protected function setUp(): void
    {
        $this->wpdb       = new InMemoryVaultWpdb();
        $this->repo       = new VaultRepository($this->wpdb);
        $this->controller = new VaultController($this->repo, new AuthMiddleware());

        // Default to an authenticated user with a pinned server clock so the
        // integrated path begins from a valid-auth baseline; individual tests
        // override the auth globals to simulate anonymous / cross-user callers.
        $GLOBALS['complex_patient_current_user_id'] = 42;
        $GLOBALS['complex_patient_current_time']    = '2026-02-02 08:30:00';

        // Wire the routes exactly as the plugin does, then capture the single
        // registered vault route for dispatch.
        $this->controller->registerRoutes();
        $routes      = $GLOBALS['complex_patient_registered_routes'] ?? [];
        $this->route = $routes[0] ?? [];
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
     * Dispatch a request through the registered route the way WordPress would:
     * select the entry matching $method, run its permission_callback, and only
     * on success invoke its callback. A permission failure short-circuits to
     * the WP_Error without ever reaching the handler.
     *
     * @param array<string,mixed> $params
     * @return WP_REST_Response|WP_Error
     */
    private function dispatch(string $method, array $params)
    {
        $entry = $this->routeEntryFor($method);
        $this->assertNotNull($entry, "No registered route entry for {$method}.");

        $request = new WP_REST_Request($params);

        $permission = call_user_func($entry['permission_callback'], $request);
        if (true !== $permission) {
            // Mirror WordPress: a non-true permission result is the response and
            // the route callback is never invoked.
            return $permission;
        }

        return call_user_func($entry['callback'], $request);
    }

    /**
     * Resolve the registered method entry (GET/POST) for the vault route.
     *
     * @return array<string,mixed>|null
     */
    private function routeEntryFor(string $method): ?array
    {
        foreach (($this->route['args'] ?? []) as $entry) {
            if (isset($entry['methods']) && $entry['methods'] === $method) {
                return $entry;
            }
        }

        return null;
    }

    // --- Sanity: the integrated route wiring the dispatcher depends on ---

    public function testVaultRouteExposesGetAndPostWithAuthGate(): void
    {
        $this->assertSame('complex-patient/v1', $this->route['namespace'] ?? null);

        $get  = $this->routeEntryFor('GET');
        $post = $this->routeEntryFor('POST');
        $this->assertNotNull($get);
        $this->assertNotNull($post);

        // Both methods are gated by the AuthMiddleware permission callback.
        $this->assertIsCallable($get['permission_callback']);
        $this->assertIsCallable($post['permission_callback']);
    }

    // --- 4.3 Authentication rejection at the permission gate ---

    public function testGetByAnonymousCallerIsRejectedAtGateWithoutReading(): void
    {
        // A stored blob exists for user 42, but the caller is unauthenticated.
        $this->repo->insert(42, 'medications', 'iv', 'tag', 'cipher', 1, null, '2026-02-01 00:00:00');
        $GLOBALS['complex_patient_current_user_id'] = 0;

        $response = $this->dispatch('GET', ['vault_type' => 'medications']);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_not_authenticated', $response->get_error_code());
        $this->assertSame(401, $response->get_error_data()['status']);
    }

    public function testPostByAnonymousCallerIsRejectedAtGateWithoutWriting(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 0;

        $response = $this->dispatch('POST', [
            'vault_type'   => 'medications',
            'iv'           => 'iv',
            'auth_tag'     => 'tag',
            'ciphertext'   => 'cipher',
            'sync_version' => 0,
        ]);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(401, $response->get_error_data()['status']);

        // The handler never ran, so nothing was persisted (Req 4.3).
        $this->assertSame([], $this->wpdb->rows);
    }

    public function testInvalidOrExpiredCredentialIsRejectedAtGate(): void
    {
        // A standing rest_authentication_errors WP_Error simulates an invalid /
        // expired JWT or Application Password even though a user id resolves.
        $GLOBALS['complex_patient_current_user_id']     = 42;
        $GLOBALS['complex_patient_auth_filter_result']  = new WP_Error('jwt_expired', 'expired');

        $response = $this->dispatch('GET', ['vault_type' => 'medications']);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(401, $response->get_error_data()['status']);
    }

    // --- 4.5 Cross-user denial (authorization failure) ---

    public function testCrossUserGetIsDeniedAndForeignBlobNeverReturned(): void
    {
        // User 7 owns a blob; the authenticated caller (42) targets wp_user_id 7.
        $this->repo->insert(7, 'medications', 'iv-7', 'tag-7', 'cipher-7', 4, null, '2026-02-01 00:00:00');

        $response = $this->dispatch('GET', [
            'vault_type' => 'medications',
            'wp_user_id' => 7,
        ]);

        // Requirement 4.5: denied with a 403 authorization failure at the gate,
        // and the foreign envelope is never surfaced.
        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_forbidden', $response->get_error_code());
        $this->assertSame(403, $response->get_error_data()['status']);
    }

    public function testCrossUserPostIsDeniedAndForeignBlobUnchanged(): void
    {
        $this->repo->insert(7, 'symptoms', 'iv-7', 'tag-7', 'cipher-7', 2, null, '2026-02-01 00:00:00');

        $response = $this->dispatch('POST', [
            'vault_type'   => 'symptoms',
            'wp_user_id'   => 7,
            'iv'           => 'iv-attack',
            'auth_tag'     => 'tag-attack',
            'ciphertext'   => 'cipher-attack',
            'sync_version' => 2,
        ]);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(403, $response->get_error_data()['status']);

        // The foreign user's stored blob is left completely unchanged.
        $row = $this->wpdb->rows['7|symptoms'];
        $this->assertSame('iv-7', $row['iv']);
        $this->assertSame('cipher-7', $row['ciphertext']);
        $this->assertSame(2, $row['sync_version']);
    }

    public function testSameUserExplicitIdIsAllowedThroughGate(): void
    {
        // Naming one's own wp_user_id is authorized (it equals the caller).
        $this->repo->insert(42, 'conditions', 'iv-self', 'tag-self', 'cipher-self', 1, null, '2026-02-01 00:00:00');

        $response = $this->dispatch('GET', [
            'vault_type' => 'conditions',
            'wp_user_id' => 42,
        ]);

        $this->assertInstanceOf(WP_REST_Response::class, $response);
        $this->assertSame(200, $response->get_status());
        $this->assertSame('cipher-self', $response->get_data()['ciphertext']);
    }

    // --- 6.6 Unrecognized vault_type rejected past the gate ---

    public function testRecognizedAuthButUnrecognizedVaultTypeIsRejectedWithoutStorage(): void
    {
        $response = $this->dispatch('GET', ['vault_type' => 'not-a-partition']);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_unrecognized_vault_type', $response->get_error_code());
        $this->assertSame(400, $response->get_error_data()['status']);
        $this->assertSame([], $this->wpdb->rows);
    }

    public function testPostUnrecognizedVaultTypeIsRejectedWithoutWriting(): void
    {
        $response = $this->dispatch('POST', [
            'vault_type'   => 'not-a-partition',
            'iv'           => 'iv',
            'auth_tag'     => 'tag',
            'ciphertext'   => 'cipher',
            'sync_version' => 0,
        ]);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(400, $response->get_error_data()['status']);
        $this->assertSame([], $this->wpdb->rows);
    }

    // --- 4.7 Missing required encrypted field rejected past the gate ---

    public function testPostMissingCiphertextIsRejectedIdentifyingFieldPersistingNothing(): void
    {
        $response = $this->dispatch('POST', [
            'vault_type'   => 'medications',
            'iv'           => 'iv',
            'auth_tag'     => 'tag',
            'sync_version' => 0,
            // ciphertext omitted
        ]);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_missing_field', $response->get_error_code());

        $data = $response->get_error_data();
        $this->assertSame(400, $data['status']);
        $this->assertSame('ciphertext', $data['field']);

        // Requirement 4.7: nothing is persisted on rejection.
        $this->assertSame([], $this->wpdb->rows);
    }

    // --- 6.7 GET 404 for recognized-but-empty partition ---

    public function testGetRecognizedVaultTypeWithNoDataReturnsNotFound(): void
    {
        $response = $this->dispatch('GET', ['vault_type' => 'flares']);

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_vault_not_found', $response->get_error_code());
        $this->assertSame(404, $response->get_error_data()['status']);
    }

    // --- 6.2 / 6.3 GET/POST success contract over the full path ---

    public function testPostThenGetRoundTripsTheBlindEnvelope(): void
    {
        // POST an initial blob: concurrency requires sync_version 0 for a first
        // write, and the accepted write establishes stored version 1 (Req 6.3).
        $postResponse = $this->dispatch('POST', [
            'vault_type'   => 'associations',
            'iv'           => 'iv-round',
            'auth_tag'     => 'tag-round',
            'ciphertext'   => 'cipher-round',
            'sync_version' => 0,
        ]);

        $this->assertInstanceOf(WP_REST_Response::class, $postResponse);
        $this->assertSame(200, $postResponse->get_status());
        $this->assertSame(['sync_version' => 1], $postResponse->get_data());

        // Requirement 6.4: persisted with server_updated_at = pinned server time.
        $this->assertSame('2026-02-02 08:30:00', $this->wpdb->rows['42|associations']['server_updated_at']);

        // GET returns exactly the stored blind envelope for the same user/type.
        $getResponse = $this->dispatch('GET', ['vault_type' => 'associations']);

        $this->assertInstanceOf(WP_REST_Response::class, $getResponse);
        $this->assertSame(200, $getResponse->get_status());
        $this->assertSame(
            [
                'sync_version' => 1,
                'iv'           => 'iv-round',
                'auth_tag'     => 'tag-round',
                'ciphertext'   => 'cipher-round',
            ],
            $getResponse->get_data()
        );
    }

    public function testPostUpdateThenGetReflectsIncrementedVersionAndNewCiphertext(): void
    {
        // Seed an existing blob, then drive an update through the full path.
        $this->repo->insert(42, 'medications', 'iv-old', 'tag-old', 'cipher-old', 3, null, '2026-02-01 00:00:00');

        $postResponse = $this->dispatch('POST', [
            'vault_type'   => 'medications',
            'iv'           => 'iv-new',
            'auth_tag'     => 'tag-new',
            'ciphertext'   => 'cipher-new',
            'sync_version' => 3,
        ]);

        $this->assertInstanceOf(WP_REST_Response::class, $postResponse);
        $this->assertSame(['sync_version' => 4], $postResponse->get_data());

        $getResponse = $this->dispatch('GET', ['vault_type' => 'medications']);

        $this->assertInstanceOf(WP_REST_Response::class, $getResponse);
        $this->assertSame(
            [
                'sync_version' => 4,
                'iv'           => 'iv-new',
                'auth_tag'     => 'tag-new',
                'ciphertext'   => 'cipher-new',
            ],
            $getResponse->get_data()
        );
    }
}
