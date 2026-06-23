<?php

declare(strict_types=1);

namespace ComplexPatient\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\DeviceRepository;

/**
 * REST controller for cross-device push registration.
 *
 *   PUT    /wp-json/complex-patient/v1/devices
 *   DELETE /wp-json/complex-patient/v1/devices/{device_id}
 *
 * Stores only opaque push endpoints — never vault ciphertext or PHI.
 */
final class DeviceController
{
    public const NAMESPACE = 'complex-patient/v1';

    /** @var list<string> */
    private const ALLOWED_PLATFORMS = ['ios', 'android', 'web'];

    /** @var list<string> */
    private const ALLOWED_PROVIDERS = ['expo', 'webpush'];

    public function __construct(
        private readonly DeviceRepository $repository,
        private readonly AuthMiddleware $auth
    ) {
    }

    public function registerRoutes(): void
    {
        register_rest_route(
            self::NAMESPACE,
            '/devices',
            [
                [
                    'methods'             => 'PUT',
                    'callback'            => [$this, 'handlePut'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
            ]
        );

        register_rest_route(
            self::NAMESPACE,
            '/devices/(?P<device_id>[a-zA-Z0-9_-]+)',
            [
                [
                    'methods'             => 'DELETE',
                    'callback'            => [$this, 'handleDelete'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
            ]
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

        $deviceId      = (string) $request->get_param('device_id');
        $platform      = (string) $request->get_param('platform');
        $pushToken     = (string) $request->get_param('push_token');
        $pushProvider  = (string) $request->get_param('push_provider');
        $serverNow     = $this->serverNow();

        $this->repository->upsert(
            $userId,
            $deviceId,
            $platform,
            $pushToken,
            $pushProvider,
            $serverNow
        );

        return new \WP_REST_Response(
            [
                'device_id'      => $deviceId,
                'platform'       => $platform,
                'push_provider'  => $pushProvider,
            ],
            200
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

        $deviceId = (string) $request->get_param('device_id');
        if ('' === $deviceId) {
            return new \WP_Error(
                'complex_patient_missing_field',
                'The required field "device_id" is missing or empty.',
                ['status' => 400, 'field' => 'device_id']
            );
        }

        $this->repository->delete($userId, $deviceId);

        return new \WP_REST_Response(['deleted' => true], 200);
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_Error|null
     */
    private function validatePayload($request): ?\WP_Error
    {
        $deviceId = $request->get_param('device_id');
        if (! is_string($deviceId) || '' === $deviceId || strlen($deviceId) > 64) {
            return new \WP_Error(
                'complex_patient_missing_field',
                'A non-empty "device_id" (max 64 characters) is required.',
                ['status' => 400, 'field' => 'device_id']
            );
        }

        $platform = $request->get_param('platform');
        if (! is_string($platform) || ! in_array($platform, self::ALLOWED_PLATFORMS, true)) {
            return new \WP_Error(
                'complex_patient_invalid_platform',
                'platform must be one of: ios, android, web.',
                ['status' => 400, 'field' => 'platform']
            );
        }

        $pushToken = $request->get_param('push_token');
        if (! is_string($pushToken) || '' === $pushToken || strlen($pushToken) > 512) {
            return new \WP_Error(
                'complex_patient_missing_field',
                'A non-empty "push_token" (max 512 characters) is required.',
                ['status' => 400, 'field' => 'push_token']
            );
        }

        $pushProvider = $request->get_param('push_provider');
        if (! is_string($pushProvider) || ! in_array($pushProvider, self::ALLOWED_PROVIDERS, true)) {
            return new \WP_Error(
                'complex_patient_invalid_push_provider',
                'push_provider must be one of: expo, webpush.',
                ['status' => 400, 'field' => 'push_provider']
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
                    'Authentication is required to register a device.',
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
