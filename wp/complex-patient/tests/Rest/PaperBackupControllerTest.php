<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\PaperBackupRepository;
use ComplexPatient\Rest\PaperBackupController;
use ComplexPatient\Tests\InMemoryPaperBackupWpdb;
use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class PaperBackupControllerTest extends TestCase
{
    private InMemoryPaperBackupWpdb $wpdb;
    private PaperBackupRepository $repo;
    private PaperBackupController $controller;

    private const BACKUP_ID = '11111111-1111-4111-8111-111111111111';

    protected function setUp(): void
    {
        $this->wpdb       = new InMemoryPaperBackupWpdb();
        $this->repo       = new PaperBackupRepository($this->wpdb);
        $this->controller = new PaperBackupController($this->repo, new AuthMiddleware());

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

    public function testCreateListGetAndDeletePaperBackup(): void
    {
        $cipher = base64_encode('encrypted-envelope');

        $create = $this->controller->handleCreate($this->request([
            'backup_id'  => self::BACKUP_ID,
            'label'      => 'Home safe',
            'iv'         => 'iv-base64',
            'auth_tag'   => 'tag-base64',
            'ciphertext' => $cipher,
        ]));

        $this->assertInstanceOf(WP_REST_Response::class, $create);
        $this->assertSame(201, $create->get_status());

        $list = $this->controller->handleList($this->request([]));
        $this->assertInstanceOf(WP_REST_Response::class, $list);
        $this->assertCount(1, $list->get_data()['backups']);

        $get = $this->controller->handleGet($this->request(['backup_id' => self::BACKUP_ID]));
        $this->assertInstanceOf(WP_REST_Response::class, $get);
        $this->assertSame($cipher, $get->get_data()['ciphertext']);

        $delete = $this->controller->handleDelete($this->request(['backup_id' => self::BACKUP_ID]));
        $this->assertInstanceOf(WP_REST_Response::class, $delete);

        $missing = $this->controller->handleGet($this->request(['backup_id' => self::BACKUP_ID]));
        $this->assertInstanceOf(WP_Error::class, $missing);
        $this->assertSame(404, $missing->get_error_data()['status']);
    }

    public function testUpdateReplacesEnvelope(): void
    {
        $cipher = base64_encode('encrypted-envelope');
        $this->controller->handleCreate($this->request([
            'backup_id'  => self::BACKUP_ID,
            'iv'         => 'iv-base64',
            'auth_tag'   => 'tag-base64',
            'ciphertext' => $cipher,
        ]));

        $updatedCipher = base64_encode('rotated-envelope');
        $update = $this->controller->handleUpdate($this->request([
            'backup_id'  => self::BACKUP_ID,
            'iv'         => 'iv-new',
            'auth_tag'   => 'tag-new',
            'ciphertext' => $updatedCipher,
        ]));
        $this->assertInstanceOf(WP_REST_Response::class, $update);

        $get = $this->controller->handleGet($this->request(['backup_id' => self::BACKUP_ID]));
        $this->assertInstanceOf(WP_REST_Response::class, $get);
        $this->assertSame($updatedCipher, $get->get_data()['ciphertext']);
    }

    public function testCreateRejectsInvalidBackupId(): void
    {
        $response = $this->controller->handleCreate($this->request([
            'backup_id'  => 'not-a-uuid',
            'iv'         => 'iv',
            'auth_tag'   => 'tag',
            'ciphertext' => base64_encode('x'),
        ]));

        $this->assertInstanceOf(WP_Error::class, $response);
        $this->assertSame(400, $response->get_error_data()['status']);
    }
}
