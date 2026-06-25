<?php

declare(strict_types=1);

namespace ComplexPatient\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\PaperBackupRepository;

/**
 * REST controller for user-managed paper backup envelopes.
 *
 *   GET    /wp-json/complex-patient/v1/vault/paper-backups
 *   POST   /wp-json/complex-patient/v1/vault/paper-backups
 *   GET    /wp-json/complex-patient/v1/vault/paper-backups/{backup_id}
 *   DELETE /wp-json/complex-patient/v1/vault/paper-backups/{backup_id}
 *
 * The server stores only opaque ciphertext. Mnemonics and KEKs never cross this
 * boundary; admins cannot recover accounts from these records.
 */
final class PaperBackupController
{
    public const NAMESPACE = 'complex-patient/v1';

    private const UUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';

    public function __construct(
        private readonly PaperBackupRepository $repository,
        private readonly AuthMiddleware $auth
    ) {
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    public function registerRoutes(): void
    {
        register_rest_route(
            self::NAMESPACE,
            '/vault/paper-backups',
            [
                [
                    'methods'             => 'GET',
                    'callback'            => [$this, 'handleList'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
                [
                    'methods'             => 'POST',
                    'callback'            => [$this, 'handleCreate'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
            ]
        );

        register_rest_route(
            self::NAMESPACE,
            '/vault/paper-backups/(?P<backup_id>[0-9a-f-]{36})',
            [
                [
                    'methods'             => 'GET',
                    'callback'            => [$this, 'handleGet'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
                [
                    'methods'             => 'DELETE',
                    'callback'            => [$this, 'handleDelete'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
                [
                    'methods'             => 'PUT',
                    'callback'            => [$this, 'handleUpdate'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
            ]
        );
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleList($request)
    {
        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            return $userId;
        }

        return new \WP_REST_Response(
            ['backups' => $this->repository->listForUser($userId)],
            200
        );
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleGet($request)
    {
        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            return $userId;
        }

        $backupId = (string) $request->get_param('backup_id');
        $validationError = $this->validateBackupId($backupId);
        if (null !== $validationError) {
            return $validationError;
        }

        $record = $this->repository->findForUser($userId, $backupId);
        if (null === $record) {
            return new \WP_Error(
                'complex_patient_paper_backup_not_found',
                'No paper backup exists with that id for this user.',
                ['status' => 404]
            );
        }

        return new \WP_REST_Response(
            [
                'backup_id'  => $record['backup_id'],
                'label'      => $record['label'],
                'iv'         => $record['iv'],
                'auth_tag'   => $record['auth_tag'],
                'ciphertext' => $record['ciphertext'],
                'created_at' => $record['created_at'],
            ],
            200
        );
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleCreate($request)
    {
        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            return $userId;
        }

        $validationError = $this->validateCreatePayload($request);
        if (null !== $validationError) {
            return $validationError;
        }

        $backupId = (string) $request->get_param('backup_id');
        $label    = $request->get_param('label');
        $label    = is_string($label) && '' !== trim($label) ? trim($label) : null;
        $iv       = (string) $request->get_param('iv');
        $authTag  = (string) $request->get_param('auth_tag');
        $cipherB64 = (string) $request->get_param('ciphertext');
        if (! self::isValidBase64Ciphertext($cipherB64)) {
            return new \WP_Error(
                'complex_patient_invalid_ciphertext',
                'ciphertext must be a non-empty base64 string.',
                ['status' => 400, 'field' => 'ciphertext']
            );
        }

        if (null !== $this->repository->findForUser($userId, $backupId)) {
            return new \WP_Error(
                'complex_patient_paper_backup_exists',
                'A paper backup with this id already exists.',
                ['status' => 409, 'field' => 'backup_id']
            );
        }

        try {
            $this->repository->insert(
                $userId,
                $backupId,
                $label,
                $iv,
                $authTag,
                $cipherB64,
                $createdAt = $this->serverNow()
            );
        } catch (\Throwable $exception) {
            return new \WP_Error(
                'complex_patient_paper_backup_store_failed',
                'Could not store the paper backup envelope.',
                ['status' => 500, 'detail' => $exception->getMessage()]
            );
        }

        return new \WP_REST_Response(
            [
                'backup_id'  => $backupId,
                'label'      => $label,
                'created_at' => $createdAt,
            ],
            201
        );
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleDelete($request)
    {
        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            return $userId;
        }

        $backupId = (string) $request->get_param('backup_id');
        $validationError = $this->validateBackupId($backupId);
        if (null !== $validationError) {
            return $validationError;
        }

        $deleted = $this->repository->deleteForUser($userId, $backupId);
        if (0 === $deleted) {
            return new \WP_Error(
                'complex_patient_paper_backup_not_found',
                'No paper backup exists with that id for this user.',
                ['status' => 404]
            );
        }

        return new \WP_REST_Response(['deleted' => true], 200);
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleUpdate($request)
    {
        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            return $userId;
        }

        $backupId = (string) $request->get_param('backup_id');
        $validationError = $this->validateBackupId($backupId);
        if (null !== $validationError) {
            return $validationError;
        }

        $envelopeError = $this->validateEnvelopeFields($request);
        if (null !== $envelopeError) {
            return $envelopeError;
        }

        if (null === $this->repository->findForUser($userId, $backupId)) {
            return new \WP_Error(
                'complex_patient_paper_backup_not_found',
                'No paper backup exists with that id for this user.',
                ['status' => 404]
            );
        }

        $iv        = (string) $request->get_param('iv');
        $authTag   = (string) $request->get_param('auth_tag');
        $cipherB64 = (string) $request->get_param('ciphertext');
        if (! self::isValidBase64Ciphertext($cipherB64)) {
            return new \WP_Error(
                'complex_patient_invalid_ciphertext',
                'ciphertext must be a non-empty base64 string.',
                ['status' => 400, 'field' => 'ciphertext']
            );
        }

        $this->repository->updateEnvelope($userId, $backupId, $iv, $authTag, $cipherB64);

        return new \WP_REST_Response(['backup_id' => $backupId, 'updated' => true], 200);
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_Error|null
     */
    private function validateEnvelopeFields($request): ?\WP_Error
    {
        foreach (['iv', 'auth_tag', 'ciphertext'] as $field) {
            $value = $request->get_param($field);
            if (! is_string($value) || '' === $value) {
                return new \WP_Error(
                    'complex_patient_missing_field',
                    sprintf('The required field "%s" is missing or empty.', $field),
                    ['status' => 400, 'field' => $field]
                );
            }
        }

        return null;
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_Error|null
     */
    private function validateCreatePayload($request): ?\WP_Error
    {
        $backupId = $request->get_param('backup_id');
        if (! is_string($backupId) || ! preg_match(self::UUID_PATTERN, $backupId)) {
            return new \WP_Error(
                'complex_patient_invalid_backup_id',
                'backup_id must be a UUID.',
                ['status' => 400, 'field' => 'backup_id']
            );
        }

        $envelopeError = $this->validateEnvelopeFields($request);
        if (null !== $envelopeError) {
            return $envelopeError;
        }

        $label = $request->get_param('label');
        if (null !== $label && ! is_string($label)) {
            return new \WP_Error(
                'complex_patient_invalid_label',
                'label must be a string when provided.',
                ['status' => 400, 'field' => 'label']
            );
        }

        if (is_string($label) && strlen($label) > 128) {
            return new \WP_Error(
                'complex_patient_invalid_label',
                'label must be 128 characters or fewer.',
                ['status' => 400, 'field' => 'label']
            );
        }

        return null;
    }

    private function validateBackupId(string $backupId): ?\WP_Error
    {
        if (! preg_match(self::UUID_PATTERN, $backupId)) {
            return new \WP_Error(
                'complex_patient_invalid_backup_id',
                'backup_id must be a UUID.',
                ['status' => 400, 'field' => 'backup_id']
            );
        }

        return null;
    }

    /**
     * @param \WP_REST_Request $request
     * @return int|\WP_Error
     */
    private function resolveUserId($request)
    {
        $result = $this->auth->authenticateRequest($request);

        if (! $result->isAuthorized() || null === $result->userId()) {
            return $result->toPermissionResult() instanceof \WP_Error
                ? $result->toPermissionResult()
                : new \WP_Error(
                    'complex_patient_not_authenticated',
                    'Authentication is required to access paper backups.',
                    ['status' => 401]
                );
        }

        return $result->userId();
    }

    private function serverNow(): string
    {
        if (function_exists('current_time')) {
            return (string) current_time('mysql', true);
        }

        return gmdate('Y-m-d H:i:s');
    }

    /**
     * Validate opaque ciphertext without decoding it for storage. WordPress wpdb
     * cannot safely insert raw binary blobs; store the client base64 string like
     * the blind vault envelopes.
     */
    private static function isValidBase64Ciphertext(string $cipherB64): bool
    {
        if ('' === $cipherB64) {
            return false;
        }

        $decoded = base64_decode($cipherB64, true);

        return false !== $decoded && '' !== $decoded;
    }
}
