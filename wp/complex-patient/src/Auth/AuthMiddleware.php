<?php

declare(strict_types=1);

namespace ComplexPatient\Auth;

/**
 * Authentication and authorization middleware for the blind sync backend.
 *
 * Implements Requirement 4 (Blind Server Authentication and Authorization):
 *  - 4.1 The client authenticates via the WordPress REST API using JWT tokens
 *        or Application Passwords. Both schemes resolve to a logged-in
 *        WordPress user via WordPress' own `determine_current_user` pipeline;
 *        this middleware consumes the resolved identity.
 *  - 4.2 A request carrying a valid authenticated user is authorized, scoped
 *        to that user.
 *  - 4.3 A missing, invalid, or expired credential is rejected with an
 *        authentication-failure indication (HTTP 401) and performs no read or
 *        write.
 *  - 4.5 An authenticated user requesting a Vault_Blob owned by a different
 *        wp_user_id is denied with an authorization-failure indication
 *        (HTTP 403) and the foreign blob is never returned.
 *  - 4.8 The Master_Passphrase and KEK are excluded from all storage and
 *        processing.
 *
 * The decision core (`evaluate`) is a pure function of primitive inputs so it
 * can be unit-tested without a live WordPress runtime. The WordPress-facing
 * wrappers translate REST requests and the global auth state into those
 * primitives and back into permission-callback return values.
 */
final class AuthMiddleware
{
    /**
     * Request fields that are key material and must never be stored or
     * processed by the blind backend (Requirement 4.8). Comparison is
     * case-insensitive and ignores separators, so e.g. "Master-Passphrase"
     * and "master_passphrase" are both caught.
     *
     * @var list<string>
     */
    private const KEY_MATERIAL_FIELDS = [
        'masterpassphrase',
        'passphrase',
        'kek',
        'keyencryptionkey',
        'derivedkey',
        'masterkey',
    ];

    /**
     * Pure authorization decision.
     *
     * @param int      $currentUserId   The WordPress user id resolved from the
     *                                   request credentials; 0 when no valid
     *                                   user could be resolved.
     * @param bool     $hasAuthError    True when credentials were supplied but
     *                                   are invalid or expired (Req 4.3).
     * @param int|null $requestedUserId The wp_user_id the request targets, or
     *                                   null when the request implicitly
     *                                   targets the caller's own scope.
     */
    public static function evaluate(int $currentUserId, bool $hasAuthError, ?int $requestedUserId): AuthResult
    {
        // Requirement 4.3: supplied credentials that are invalid or expired are
        // an authentication failure regardless of any resolved id.
        if ($hasAuthError) {
            return AuthResult::notAuthenticated('The supplied credentials are invalid or expired.');
        }

        // Requirement 4.3: no authenticated user (missing credentials).
        if ($currentUserId <= 0) {
            return AuthResult::notAuthenticated('Authentication is required to access the vault.');
        }

        // Requirement 4.5: deny access to a different user's vault. A request
        // that does not name a user (null) is implicitly scoped to the caller.
        if (null !== $requestedUserId && $requestedUserId !== $currentUserId) {
            return AuthResult::forbidden('You are not allowed to access another user\'s vault.');
        }

        // Requirement 4.2: valid user → authorize, scoped to that user.
        return AuthResult::authorized($currentUserId);
    }

    /**
     * Evaluate a REST request against the current WordPress auth state.
     *
     * Resolves the authenticated user id and any standing authentication error
     * from WordPress, extracts an optional requested wp_user_id from the
     * request, and returns a typed {@see AuthResult}.
     *
     * @param \WP_REST_Request $request
     */
    public function authenticateRequest($request): AuthResult
    {
        $currentUserId = $this->resolveCurrentUserId();
        $hasAuthError  = $this->hasAuthenticationError();
        $requestedUser = $this->extractRequestedUserId($request);

        return self::evaluate($currentUserId, $hasAuthError, $requestedUser);
    }

    /**
     * WordPress `permission_callback` adapter.
     *
     * Returns true to allow the request to proceed, or a WP_Error describing
     * the authentication/authorization failure so that no controller logic
     * (and therefore no read or write) runs (Requirements 4.3, 4.5).
     *
     * @param \WP_REST_Request $request
     * @return true|\WP_Error
     */
    public function permissionCallback($request)
    {
        return $this->authenticateRequest($request)->toPermissionResult();
    }

    /**
     * Determine whether an associative payload carries forbidden key material.
     *
     * Used to enforce Requirement 4.8: the backend must never store or process
     * the Master_Passphrase or KEK. Detection is case- and separator-
     * insensitive.
     *
     * @param array<string,mixed> $data
     */
    public static function containsKeyMaterial(array $data): bool
    {
        foreach (array_keys($data) as $key) {
            if (self::isKeyMaterialField((string) $key)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Remove any key-material fields from a payload before it is stored or
     * processed (Requirement 4.8). The returned array is a copy; the input is
     * left unmodified.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public static function stripKeyMaterial(array $data): array
    {
        $clean = [];
        foreach ($data as $key => $value) {
            if (self::isKeyMaterialField((string) $key)) {
                continue;
            }
            $clean[$key] = $value;
        }

        return $clean;
    }

    /**
     * Normalize a field name and test it against the key-material denylist.
     */
    private static function isKeyMaterialField(string $field): bool
    {
        // Strip everything but letters and l-case, so "master_passphrase",
        // "Master-Passphrase", and "masterPassphrase" all normalize equally.
        $normalized = strtolower((string) preg_replace('/[^A-Za-z]/', '', $field));

        return in_array($normalized, self::KEY_MATERIAL_FIELDS, true);
    }

    /**
     * Resolve the current WordPress user id, defending against environments
     * where the helper is unavailable.
     */
    private function resolveCurrentUserId(): int
    {
        if (function_exists('get_current_user_id')) {
            return (int) get_current_user_id();
        }

        return 0;
    }

    /**
     * Detect a standing authentication error produced by WordPress' auth
     * pipeline (e.g. an invalid or expired JWT / Application Password).
     *
     * WordPress exposes the determination through the `rest_authentication_errors`
     * filter: it yields a WP_Error on failure, true on success, and null when
     * no credentials were evaluated.
     */
    private function hasAuthenticationError(): bool
    {
        if (! function_exists('apply_filters')) {
            return false;
        }

        $result = apply_filters('rest_authentication_errors', null);

        return function_exists('is_wp_error') && is_wp_error($result);
    }

    /**
     * Extract an explicitly requested wp_user_id from the request, or null when
     * the request does not name one (implicitly the caller's own scope).
     *
     * @param \WP_REST_Request $request
     */
    private function extractRequestedUserId($request): ?int
    {
        if (! is_object($request) || ! method_exists($request, 'get_param')) {
            return null;
        }

        $value = $request->get_param('wp_user_id');

        if (null === $value || '' === $value) {
            return null;
        }

        return (int) $value;
    }
}
