<?php

declare(strict_types=1);

namespace ComplexPatient\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\KdfMaterialRepository;

/**
 * REST controller for cross-device KDF material sync.
 *
 *   GET /wp-json/complex-patient/v1/vault/kdf-material
 *   PUT /wp-json/complex-patient/v1/vault/kdf-material
 *
 * The salt and KDF parameters are non-secret metadata required to re-derive the
 * same KEK on every device for a WordPress user. The Master_Passphrase and KEK
 * never cross this boundary (Requirements 1.3, 1.4).
 */
final class KdfMaterialController
{
    public const NAMESPACE = 'complex-patient/v1';

    private const MIN_SALT_BYTES = 16;

    /** @var list<string> */
    private const ALLOWED_ALGORITHMS = ['PBKDF2', 'Argon2id'];

    private const MIN_PBKDF2_ITERATIONS = 600_000;

    public function __construct(
        private readonly KdfMaterialRepository $repository,
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
            '/vault/kdf-material',
            [
                [
                    'methods'             => 'GET',
                    'callback'            => [$this, 'handleGet'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
                [
                    'methods'             => 'PUT',
                    'callback'            => [$this, 'handlePut'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
            ]
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

        $material = $this->repository->find($userId);

        if (null === $material) {
            return new \WP_Error(
                'complex_patient_kdf_not_found',
                'No KDF material exists for this user.',
                ['status' => 404]
            );
        }

        return new \WP_REST_Response(
            [
                'salt_base64' => $material['salt_base64'],
                'params'      => $material['params'],
            ],
            200
        );
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handlePut($request)
    {
        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            return $userId;
        }

        $validationError = $this->validatePayload($request);
        if (null !== $validationError) {
            return $validationError;
        }

        $saltBase64 = (string) $request->get_param('salt_base64');
        $params     = $this->normalizeParams($request->get_param('params'));
        $serverNow  = $this->serverNow();

        $existing = $this->repository->find($userId);

        if (null === $existing) {
            $this->repository->insert($userId, $saltBase64, $params, $serverNow);
        } else {
            $this->repository->update($userId, $saltBase64, $params, $serverNow);
        }

        return new \WP_REST_Response(
            [
                'salt_base64' => $saltBase64,
                'params'      => $params,
            ],
            200
        );
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_Error|null
     */
    private function validatePayload($request): ?\WP_Error
    {
        $saltBase64 = $request->get_param('salt_base64');
        if (null === $saltBase64 || '' === (string) $saltBase64) {
            return new \WP_Error(
                'complex_patient_missing_field',
                'The required field "salt_base64" is missing or empty.',
                ['status' => 400, 'field' => 'salt_base64']
            );
        }

        $decoded = base64_decode((string) $saltBase64, true);
        if (false === $decoded || strlen($decoded) < self::MIN_SALT_BYTES) {
            return new \WP_Error(
                'complex_patient_invalid_salt',
                sprintf('salt_base64 must decode to at least %d bytes.', self::MIN_SALT_BYTES),
                ['status' => 400, 'field' => 'salt_base64']
            );
        }

        $params = $request->get_param('params');
        if (! is_array($params)) {
            return new \WP_Error(
                'complex_patient_missing_field',
                'The required field "params" is missing or invalid.',
                ['status' => 400, 'field' => 'params']
            );
        }

        $algorithm = $params['algorithm'] ?? null;
        if (! is_string($algorithm) || ! in_array($algorithm, self::ALLOWED_ALGORITHMS, true)) {
            return new \WP_Error(
                'complex_patient_invalid_kdf_params',
                'params.algorithm must be "PBKDF2" or "Argon2id".',
                ['status' => 400, 'field' => 'params.algorithm']
            );
        }

        if ('PBKDF2' === $algorithm) {
            $iterations = $params['pbkdf2Iterations'] ?? self::MIN_PBKDF2_ITERATIONS;
            if (! is_int($iterations) && ! (is_string($iterations) && 1 === preg_match('/^\d+$/', $iterations))) {
                return new \WP_Error(
                    'complex_patient_invalid_kdf_params',
                    'params.pbkdf2Iterations must be a non-negative integer.',
                    ['status' => 400, 'field' => 'params.pbkdf2Iterations']
                );
            }

            if ((int) $iterations < self::MIN_PBKDF2_ITERATIONS) {
                return new \WP_Error(
                    'complex_patient_invalid_kdf_params',
                    sprintf('params.pbkdf2Iterations must be at least %d.', self::MIN_PBKDF2_ITERATIONS),
                    ['status' => 400, 'field' => 'params.pbkdf2Iterations']
                );
            }
        }

        return null;
    }

    /**
     * @param mixed $params
     * @return array<string,mixed>
     */
    private function normalizeParams($params): array
    {
        $algorithm = (string) ($params['algorithm'] ?? 'PBKDF2');
        $normalized = ['algorithm' => $algorithm];

        if ('PBKDF2' === $algorithm) {
            $normalized['pbkdf2Iterations'] = (int) ($params['pbkdf2Iterations'] ?? self::MIN_PBKDF2_ITERATIONS);
        }

        if ('Argon2id' === $algorithm && isset($params['argonMemoryKiB'])) {
            $normalized['argonMemoryKiB'] = (int) $params['argonMemoryKiB'];
        }

        return $normalized;
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
                    'Authentication is required to access KDF material.',
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
}
