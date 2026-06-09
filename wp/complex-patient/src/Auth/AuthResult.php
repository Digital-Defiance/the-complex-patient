<?php

declare(strict_types=1);

namespace ComplexPatient\Auth;

/**
 * Immutable outcome of an authentication / authorization evaluation.
 *
 * A result is either a success that carries the resolved, caller-scoped
 * wp_user_id, or a failure that carries a stable machine-readable error code,
 * an HTTP status, and a user-facing message. Failures never expose a user id.
 *
 * The middleware returns these typed values (rather than throwing) so callers
 * must explicitly branch on failure before any read or write occurs
 * (Requirements 4.3, 4.5).
 */
final class AuthResult
{
    /** Authentication failure: missing / invalid / expired credentials (Req 4.3). */
    public const ERROR_NOT_AUTHENTICATED = 'complex_patient_not_authenticated';

    /** Authorization failure: cross-user access attempt (Req 4.5). */
    public const ERROR_FORBIDDEN = 'complex_patient_forbidden';

    private bool $ok;

    private ?int $userId;

    private ?string $errorCode;

    private int $httpStatus;

    private ?string $message;

    private function __construct(
        bool $ok,
        ?int $userId,
        ?string $errorCode,
        int $httpStatus,
        ?string $message
    ) {
        $this->ok         = $ok;
        $this->userId     = $userId;
        $this->errorCode  = $errorCode;
        $this->httpStatus = $httpStatus;
        $this->message    = $message;
    }

    /**
     * Build a success result scoped to the resolved wp_user_id.
     */
    public static function authorized(int $userId): self
    {
        return new self(true, $userId, null, 200, null);
    }

    /**
     * Build an authentication-failure result (HTTP 401).
     *
     * Used when credentials are missing, invalid, or expired (Req 4.3).
     */
    public static function notAuthenticated(
        string $message = 'Authentication is required to access the vault.'
    ): self {
        return new self(false, null, self::ERROR_NOT_AUTHENTICATED, 401, $message);
    }

    /**
     * Build an authorization-failure result (HTTP 403).
     *
     * Used when an authenticated user requests another user's data (Req 4.5).
     */
    public static function forbidden(
        string $message = 'You are not allowed to access this vault.'
    ): self {
        return new self(false, null, self::ERROR_FORBIDDEN, 403, $message);
    }

    public function isAuthorized(): bool
    {
        return $this->ok;
    }

    /**
     * Resolved caller-scoped wp_user_id, or null on failure.
     */
    public function userId(): ?int
    {
        return $this->userId;
    }

    public function errorCode(): ?string
    {
        return $this->errorCode;
    }

    public function httpStatus(): int
    {
        return $this->httpStatus;
    }

    public function message(): ?string
    {
        return $this->message;
    }

    /**
     * Convert a failure result into a WP_Error for a REST permission callback.
     *
     * Returns true for a success result so it can be used directly as the
     * return value of a permission_callback.
     *
     * @return true|\WP_Error
     */
    public function toPermissionResult()
    {
        if ($this->ok) {
            return true;
        }

        return new \WP_Error(
            (string) $this->errorCode,
            (string) $this->message,
            ['status' => $this->httpStatus]
        );
    }
}
