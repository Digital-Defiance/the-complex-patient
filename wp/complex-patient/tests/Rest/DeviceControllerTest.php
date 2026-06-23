<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\DeviceRepository;
use ComplexPatient\Rest\DeviceController;
use ComplexPatient\Tests\InMemoryDeviceWpdb;
use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class DeviceControllerTest extends TestCase
{
    private InMemoryDeviceWpdb $wpdb;
    private DeviceRepository $repo;
    private DeviceController $controller;

    protected function setUp(): void
    {
        $this->wpdb       = new InMemoryDeviceWpdb();
        $this->repo       = new DeviceRepository($this->wpdb);
        $this->controller = new DeviceController($this->repo, new AuthMiddleware());

        $GLOBALS['complex_patient_current_user_id'] = 42;
        $GLOBALS['complex_patient_current_time']    = '2026-01-01 12:00:00';
    }

    protected function tearDown(): void
    {
        unset(
            $GLOBALS['complex_patient_current_user_id'],
            $GLOBALS['complex_patient_auth_filter_result'],
            $GLOBALS['complex_patient_current_time'],
            $GLOBALS['complex_patient_registered_routes']
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

    public function testPutRegistersDeviceAndDeleteRemovesIt(): void
    {
        $putResponse = $this->controller->handlePut($this->request([
            'device_id'      => 'device-abc',
            'platform'       => 'ios',
            'push_token'     => 'ExponentPushToken[test]',
            'push_provider'  => 'expo',
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $putResponse);
        $this->assertSame(200, $putResponse->get_status());

        $stored = $this->repo->findByUserAndDeviceId(42, 'device-abc');
        $this->assertNotNull($stored);
        $this->assertSame('ExponentPushToken[test]', $stored['push_token']);

        $deleteResponse = $this->controller->handleDelete($this->request([
            'device_id' => 'device-abc',
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $deleteResponse);
        $this->assertNull($this->repo->findByUserAndDeviceId(42, 'device-abc'));
    }

    public function testPutRejectsInvalidPlatform(): void
    {
        $response = $this->controller->handlePut($this->request([
            'device_id'      => 'device-abc',
            'platform'       => 'windows',
            'push_token'     => 'token',
            'push_provider'  => 'expo',
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame('complex_patient_invalid_platform', $response->get_error_code());
    }
}
