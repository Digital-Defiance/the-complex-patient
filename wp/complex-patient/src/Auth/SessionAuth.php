<?php

declare(strict_types=1);

namespace ComplexPatient\Auth;

/**
 * Short-lived app session tokens for native clients when Basic Authorization
 * headers are stripped by the hosting stack.
 */
final class SessionAuth
{
    public const TRANSIENT_PREFIX = 'complex_patient_app_session_';

    public const HEADER_NAME = 'X-Complex-Patient-Session';

    /**
     * @param int|false $userId
     * @return int|false
     */
    public static function determineUserFromSessionToken($userId)
    {
        if (is_int($userId) && $userId > 0) {
            return $userId;
        }

        $token = self::resolveSessionToken();
        if ($token === '') {
            return $userId;
        }

        $storedUserId = get_transient(self::transientKey($token));
        if (is_numeric($storedUserId) && (int) $storedUserId > 0) {
            return (int) $storedUserId;
        }

        return $userId;
    }

    public static function issueToken(int $userId, int $ttlSeconds = DAY_IN_SECONDS): string
    {
        $token = wp_generate_password(64, false, false);
        set_transient(self::transientKey($token), $userId, $ttlSeconds);

        return $token;
    }

    public static function revokeToken(string $token): void
    {
        if ($token !== '') {
            delete_transient(self::transientKey($token));
        }
    }

    public static function transientKey(string $token): string
    {
        return self::TRANSIENT_PREFIX . hash('sha256', $token);
    }

    public static function resolveSessionToken(): string
    {
        $serverKey = 'HTTP_' . str_replace('-', '_', strtoupper(self::HEADER_NAME));
        if (! empty($_SERVER[$serverKey])) {
            return trim((string) $_SERVER[$serverKey]);
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
            if (! empty($headers[self::HEADER_NAME])) {
                return trim((string) $headers[self::HEADER_NAME]);
            }
        }

        return '';
    }
}
