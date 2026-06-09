<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Auth;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\Auth\AuthResult;
use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Request;

/**
 * Unit tests for the blind-backend authentication / authorization middleware.
 *
 * Covers Requirement 4:
 *  - 4.2 valid authenticated user is authorized, scoped to that user.
 *  - 4.3 missing / invalid / expired credentials are rejected (401) with no
 *        read or write.
 *  - 4.5 cross-user wp_user_id access is denied (403) and never returns the
 *        foreign blob.
 *  - 4.8 Master_Passphrase and KEK are excluded from storage / processing.
 */
final class AuthMiddlewareTest extends TestCase
{
    protected function tearDown(): void
    {
        unset(
            $GLOBALS['complex_patient_current_user_id'],
            $GLOBALS['complex_patient_auth_filter_result']
        );
        parent::tearDown();
    }

    // --- Pure decision core (Requirement 4.2, 4.3, 4.5) ---

    public function testEvaluateAuthorizesValidUserScopedToSelf(): void
    {
        // Req 4.2: a valid user with no explicit target is scoped to itself.
        $result = AuthMiddleware::evaluate(42, false, null);

        $this->assertTrue($result->isAuthorized());
        $this->assertSame(42, $result->userId());
        $this->assertNull($result->errorCode());
    }

    public function testEvaluateAuthorizesUserRequestingOwnUserId(): void
    {
        // Req 4.2: explicitly requesting your own wp_user_id is allowed.
        $result = AuthMiddleware::evaluate(42, false, 42);

        $this->assertTrue($result->isAuthorized());
        $this->assertSame(42, $result->userId());
    }

    public function testEvaluateRejectsMissingCredentials(): void
    {
        // Req 4.3: no resolved user (missing credentials) → 401, no user id.
        $result = AuthMiddleware::evaluate(0, false, null);

        $this->assertFalse($result->isAuthorized());
        $this->assertSame(AuthResult::ERROR_NOT_AUTHENTICATED, $result->errorCode());
        $this->assertSame(401, $result->httpStatus());
        $this->assertNull($result->userId());
    }

    public function testEvaluateRejectsInvalidOrExpiredCredentials(): void
    {
        // Req 4.3: credentials were supplied but invalid/expired → 401.
        $result = AuthMiddleware::evaluate(0, true, null);

        $this->assertFalse($result->isAuthorized());
        $this->assertSame(AuthResult::ERROR_NOT_AUTHENTICATED, $result->errorCode());
        $this->assertSame(401, $result->httpStatus());
    }

    public function testEvaluateTreatsAuthErrorAsFailureEvenWithResolvedUser(): void
    {
        // Req 4.3: a standing auth error fails closed regardless of any
        // lingering resolved id.
        $result = AuthMiddleware::evaluate(42, true, null);

        $this->assertFalse($result->isAuthorized());
        $this->assertSame(AuthResult::ERROR_NOT_AUTHENTICATED, $result->errorCode());
        $this->assertNull($result->userId());
    }

    public function testEvaluateDeniesCrossUserAccess(): void
    {
        // Req 4.5: authenticated user 42 requesting user 7's vault → 403.
        $result = AuthMiddleware::evaluate(42, false, 7);

        $this->assertFalse($result->isAuthorized());
        $this->assertSame(AuthResult::ERROR_FORBIDDEN, $result->errorCode());
        $this->assertSame(403, $result->httpStatus());
        // The foreign user id must not leak back through the result.
        $this->assertNull($result->userId());
    }

    // --- REST request integration (Requirement 4.2, 4.3, 4.5) ---

    public function testAuthenticateRequestAuthorizesLoggedInUser(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 99;
        $middleware                                 = new AuthMiddleware();

        $result = $middleware->authenticateRequest(new WP_REST_Request());

        $this->assertTrue($result->isAuthorized());
        $this->assertSame(99, $result->userId());
    }

    public function testAuthenticateRequestRejectsAnonymous(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 0;
        $middleware                                 = new AuthMiddleware();

        $result = $middleware->authenticateRequest(new WP_REST_Request());

        $this->assertFalse($result->isAuthorized());
        $this->assertSame(401, $result->httpStatus());
    }

    public function testAuthenticateRequestRejectsWhenAuthFilterReturnsError(): void
    {
        // Simulate an invalid/expired JWT surfaced via rest_authentication_errors.
        $GLOBALS['complex_patient_current_user_id']     = 0;
        $GLOBALS['complex_patient_auth_filter_result']  = new WP_Error(
            'rest_invalid_token',
            'Expired token',
            ['status' => 403]
        );
        $middleware = new AuthMiddleware();

        $result = $middleware->authenticateRequest(new WP_REST_Request());

        $this->assertFalse($result->isAuthorized());
        $this->assertSame(AuthResult::ERROR_NOT_AUTHENTICATED, $result->errorCode());
        $this->assertSame(401, $result->httpStatus());
    }

    public function testAuthenticateRequestDeniesCrossUserViaParam(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 42;
        $middleware                                 = new AuthMiddleware();

        $request = new WP_REST_Request(['wp_user_id' => 7]);
        $result  = $middleware->authenticateRequest($request);

        $this->assertFalse($result->isAuthorized());
        $this->assertSame(403, $result->httpStatus());
    }

    public function testAuthenticateRequestAllowsExplicitOwnUserIdViaParam(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 42;
        $middleware                                 = new AuthMiddleware();

        $request = new WP_REST_Request(['wp_user_id' => 42]);
        $result  = $middleware->authenticateRequest($request);

        $this->assertTrue($result->isAuthorized());
        $this->assertSame(42, $result->userId());
    }

    // --- permission_callback adapter (Requirement 4.3, 4.5) ---

    public function testPermissionCallbackReturnsTrueWhenAuthorized(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 5;
        $middleware                                 = new AuthMiddleware();

        $this->assertTrue($middleware->permissionCallback(new WP_REST_Request()));
    }

    public function testPermissionCallbackReturnsWpErrorWhenUnauthenticated(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 0;
        $middleware                                 = new AuthMiddleware();

        $error = $middleware->permissionCallback(new WP_REST_Request());

        $this->assertInstanceOf(WP_Error::class, $error);
        $this->assertSame(AuthResult::ERROR_NOT_AUTHENTICATED, $error->get_error_code());
        $this->assertSame(['status' => 401], $error->get_error_data());
    }

    public function testPermissionCallbackReturnsForbiddenWpErrorOnCrossUser(): void
    {
        $GLOBALS['complex_patient_current_user_id'] = 42;
        $middleware                                 = new AuthMiddleware();

        $error = $middleware->permissionCallback(new WP_REST_Request(['wp_user_id' => 7]));

        $this->assertInstanceOf(WP_Error::class, $error);
        $this->assertSame(AuthResult::ERROR_FORBIDDEN, $error->get_error_code());
        $this->assertSame(['status' => 403], $error->get_error_data());
    }

    // --- Key-material exclusion (Requirement 4.8) ---

    /**
     * @dataProvider keyMaterialFieldProvider
     */
    public function testContainsKeyMaterialDetectsForbiddenFields(string $field): void
    {
        $this->assertTrue(
            AuthMiddleware::containsKeyMaterial([$field => 'secret', 'iv' => 'abc']),
            "Expected '{$field}' to be detected as key material"
        );
    }

    /**
     * @return iterable<string,array{0:string}>
     */
    public static function keyMaterialFieldProvider(): iterable
    {
        yield 'master_passphrase' => ['master_passphrase'];
        yield 'Master-Passphrase' => ['Master-Passphrase'];
        yield 'masterPassphrase'  => ['masterPassphrase'];
        yield 'passphrase'        => ['passphrase'];
        yield 'kek'               => ['kek'];
        yield 'KEK upper'         => ['KEK'];
        yield 'keyEncryptionKey'  => ['keyEncryptionKey'];
        yield 'derivedKey'        => ['derivedKey'];
        yield 'masterKey'         => ['masterKey'];
    }

    public function testContainsKeyMaterialIgnoresEncryptedEnvelopeFields(): void
    {
        // The blind blob envelope is legitimate and must not be flagged.
        $envelope = [
            'iv'           => 'aXY=',
            'auth_tag'     => 'dGFn',
            'ciphertext'   => 'Y2lwaGVy',
            'sync_version' => 3,
        ];

        $this->assertFalse(AuthMiddleware::containsKeyMaterial($envelope));
    }

    public function testStripKeyMaterialRemovesForbiddenFieldsOnly(): void
    {
        $input = [
            'iv'                => 'aXY=',
            'auth_tag'          => 'dGFn',
            'ciphertext'        => 'Y2lwaGVy',
            'sync_version'      => 1,
            'master_passphrase' => 'hunter2hunter2',
            'kek'               => 'rawkeybytes',
        ];

        $clean = AuthMiddleware::stripKeyMaterial($input);

        $this->assertArrayNotHasKey('master_passphrase', $clean);
        $this->assertArrayNotHasKey('kek', $clean);
        $this->assertSame(
            ['iv' => 'aXY=', 'auth_tag' => 'dGFn', 'ciphertext' => 'Y2lwaGVy', 'sync_version' => 1],
            $clean
        );
        // Input is left unmodified (returns a copy).
        $this->assertArrayHasKey('master_passphrase', $input);
    }
}
