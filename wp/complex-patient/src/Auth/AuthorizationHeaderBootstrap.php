<?php

declare(strict_types=1);

namespace ComplexPatient\Auth;

/**
 * Ensures WordPress sees HTTP Basic credentials on hosts that omit
 * {@see $_SERVER['HTTP_AUTHORIZATION']} (LiteSpeed, CGI, some Android stacks).
 */
final class AuthorizationHeaderBootstrap
{
    public static function register(): void
    {
        self::bootstrap();

        add_action('plugins_loaded', [self::class, 'bootstrap'], 0);
        add_action('rest_api_init', [self::class, 'bootstrap'], -1);
        add_filter('determine_current_user', [self::class, 'determineUserFromHeaders'], 15);
        add_filter('determine_current_user', [SessionAuth::class, 'determineUserFromSessionToken'], 14);
    }

    public static function bootstrap(): void
    {
        if (! empty($_SERVER['HTTP_AUTHORIZATION'])) {
            return;
        }

        $header = self::resolveAuthorizationHeader();
        if ($header !== '') {
            $_SERVER['HTTP_AUTHORIZATION'] = $header;
        }
    }

    /**
     * @param int|false $userId
     * @return int|false
     */
    public static function determineUserFromHeaders($userId)
    {
        if (is_int($userId) && $userId > 0) {
            return $userId;
        }

        self::bootstrap();

        if (! function_exists('wp_authenticate_application_password')) {
            return $userId;
        }

        $header = self::resolveAuthorizationHeader();
        if ($header === '' || stripos($header, 'basic ') !== 0) {
            return $userId;
        }

        $decoded = base64_decode(substr($header, 6), true);
        if ($decoded === false || ! str_contains($decoded, ':')) {
            return $userId;
        }

        [$username, $password] = explode(':', $decoded, 2);
        $password            = (string) preg_replace('/\s+/', '', $password);

        $user = wp_authenticate_application_password(null, $username, $password);
        if ($user instanceof \WP_User) {
            return $user->ID;
        }

        return $userId;
    }

    public static function resolveAuthorizationHeader(): string
    {
        if (! empty($_SERVER['HTTP_AUTHORIZATION'])) {
            return (string) $_SERVER['HTTP_AUTHORIZATION'];
        }
        if (! empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            return (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
        if (! empty($_SERVER['Authorization'])) {
            return (string) $_SERVER['Authorization'];
        }
        if (! empty($_SERVER['HTTP_X_WP_AUTHORIZATION'])) {
            return (string) $_SERVER['HTTP_X_WP_AUTHORIZATION'];
        }

        $headerSets = [];
        if (function_exists('getallheaders')) {
            $headerSets[] = getallheaders();
        }
        if (function_exists('apache_request_headers')) {
            $headerSets[] = apache_request_headers();
        }

        foreach ($headerSets as $headers) {
            if (! is_array($headers)) {
                continue;
            }
            foreach (['Authorization', 'authorization', 'AUTHORIZATION'] as $key) {
                if (! empty($headers[$key])) {
                    return (string) $headers[$key];
                }
            }
            if (! empty($headers['X-WP-Authorization'])) {
                return (string) $headers['X-WP-Authorization'];
            }
        }

        if (! empty($_SERVER['PHP_AUTH_USER'])) {
            $password = (string) ($_SERVER['PHP_AUTH_PW'] ?? '');

            return 'Basic ' . base64_encode(((string) $_SERVER['PHP_AUTH_USER']) . ':' . $password);
        }

        return '';
    }
}
