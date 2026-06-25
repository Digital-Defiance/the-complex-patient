<?php

declare(strict_types=1);

namespace ComplexPatient\Rest;

use ComplexPatient\Auth\SessionAuth;

/**
 * Native-friendly credential exchange when Authorization headers do not survive
 * the hosting stack.
 *
 * POST /wp-json/complex-patient/v1/auth/exchange
 */
final class SessionController
{
    public const NAMESPACE = 'complex-patient/v1';

    public function registerRoutes(): void
    {
        register_rest_route(
            self::NAMESPACE,
            '/auth/exchange',
            [
                [
                    'methods'             => 'POST',
                    'callback'            => [$this, 'handleExchange'],
                    'permission_callback' => '__return_true',
                    'args'                => [
                        'username'             => [
                            'type'     => 'string',
                            'required' => true,
                        ],
                        'application_password' => [
                            'type'     => 'string',
                            'required' => true,
                        ],
                    ],
                ],
            ]
        );
    }

    /**
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleExchange($request)
    {
        if (! function_exists('wp_authenticate_application_password')) {
            return new \WP_Error(
                'complex_patient_app_passwords_unavailable',
                'Application Passwords are not available on this server.',
                ['status' => 501]
            );
        }

        $username = sanitize_user((string) $request->get_param('username'), true);
        $password = (string) preg_replace(
            '/\s+/',
            '',
            (string) $request->get_param('application_password')
        );

        if ($username === '' || $password === '') {
            return new \WP_Error(
                'complex_patient_invalid_credentials',
                'Username and application password are required.',
                ['status' => 401]
            );
        }

        $user = wp_authenticate_application_password(null, $username, $password);
        if (! ($user instanceof \WP_User)) {
            return new \WP_Error(
                'complex_patient_invalid_credentials',
                'WordPress did not accept those credentials.',
                ['status' => 401]
            );
        }

        $token = SessionAuth::issueToken((int) $user->ID);

        return new \WP_REST_Response(
            [
                'session_token' => $token,
                'expires_in'    => DAY_IN_SECONDS,
                'user_id'       => (int) $user->ID,
            ],
            200
        );
    }
}
