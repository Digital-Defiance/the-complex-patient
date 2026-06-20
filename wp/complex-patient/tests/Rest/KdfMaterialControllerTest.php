<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\KdfMaterialRepository;
use ComplexPatient\Rest\KdfMaterialController;
use ComplexPatient\Tests\InMemoryKdfWpdb;
use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class KdfMaterialControllerTest extends TestCase
{
    private InMemoryKdfWpdb $wpdb;
    private KdfMaterialRepository $repo;
    private KdfMaterialController $controller;

    protected function setUp(): void
    {
        $this->wpdb       = new InMemoryKdfWpdb();
        $this->repo       = new KdfMaterialRepository($this->wpdb);
        $this->controller = new KdfMaterialController($this->repo, new AuthMiddleware());

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

    public function testRegisterRoutesRegistersKdfMaterialRoute(): void
    {
        $this->controller->registerRoutes();

        $routes = $GLOBALS['complex_patient_registered_routes'] ?? [];
        $this->assertCount(1, $routes);

        $route = $routes[0];
        $this->assertSame('complex-patient/v1', $route['namespace']);
        $this->assertSame('/vault/kdf-material', $route['route']);

        $methods = array_map(static fn ($entry) => $entry['methods'], $route['args']);
        $this->assertContains('GET', $methods);
        $this->assertContains('PUT', $methods);
    }

    public function testGetReturns404WhenNoMaterialExists(): void
    {
        $response = $this->controller->handleGet($this->request([]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_kdf_not_found', $response->get_error_code());
        $this->assertSame(404, $response->get_error_data()['status']);
    }

    public function testPutCreatesMaterialAndGetReturnsIt(): void
    {
        $salt = base64_encode(str_repeat('a', 16));

        $putResponse = $this->controller->handlePut($this->request([
            'salt_base64' => $salt,
            'params'      => [
                'algorithm'         => 'PBKDF2',
                'pbkdf2Iterations'  => 600_000,
            ],
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $putResponse);
        $this->assertSame(200, $putResponse->get_status());
        $this->assertSame($salt, $putResponse->get_data()['salt_base64']);

        $getResponse = $this->controller->handleGet($this->request([]));
        $this->assertInstanceOf(WP_REST_Response::class, $getResponse);
        $this->assertSame($salt, $getResponse->get_data()['salt_base64']);
        $this->assertSame('PBKDF2', $getResponse->get_data()['params']['algorithm']);
    }

    public function testPutRejectsShortSalt(): void
    {
        $response = $this->controller->handlePut($this->request([
            'salt_base64' => base64_encode('short'),
            'params'      => ['algorithm' => 'PBKDF2', 'pbkdf2Iterations' => 600_000],
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_invalid_salt', $response->get_error_code());
    }

    public function testPutRejectsLowPbkdf2Iterations(): void
    {
        $response = $this->controller->handlePut($this->request([
            'salt_base64' => base64_encode(str_repeat('a', 16)),
            'params'      => ['algorithm' => 'PBKDF2', 'pbkdf2Iterations' => 100_000],
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_invalid_kdf_params', $response->get_error_code());
    }
}
