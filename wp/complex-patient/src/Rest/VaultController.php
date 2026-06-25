<?php

declare(strict_types=1);

namespace ComplexPatient\Rest;

use ComplexPatient\Auth\AuthMiddleware;
use ComplexPatient\Notification\VaultUpdateNotifier;
use ComplexPatient\VaultRepository;

/**
 * REST controller for the blind vault sync endpoints.
 *
 * Exposes the encrypted-blob exchange surface under the
 * `complex-patient/v1` namespace and binds it to WordPress on the
 * `rest_api_init` hook (Requirements 6.1, 6.5):
 *
 *   GET  /wp-json/complex-patient/v1/vault/{vault_type}
 *   POST /wp-json/complex-patient/v1/vault/{vault_type}
 *
 * Every route delegates authentication / authorization to {@see AuthMiddleware}
 * via its `permission_callback`, so a request that fails auth never reaches a
 * handler and therefore performs no read or write (Requirements 4.1–4.5).
 *
 * The controller is deliberately blind: it only ever reads or returns the
 * opaque envelope `{ sync_version, iv, auth_tag, ciphertext }` and never
 * inspects the plaintext of those fields (Requirements 4.6, 4.8).
 *
 * Responsibilities implemented here:
 *  - 6.1 / 6.5 register the namespaced routes on rest_api_init.
 *  - 6.2 GET returns the stored blob for a recognized vault_type / user.
 *  - 6.7 GET returns a not-found indication when no blob exists.
 *  - 6.6 reject an unrecognized vault_type without touching storage.
 *  - 4.7 / 6.8 reject a POST missing a required encrypted field, identifying
 *        the field and persisting nothing.
 *  - 6.3 / 6.4 persist a valid POST and set server_updated_at, returning the
 *        resulting sync_version.
 *
 * Optimistic concurrency control (the sync_version comparison and HTTP 409
 * behaviour of Requirement 7) is intentionally NOT implemented here; it is
 * owned by task 6.5. A single extension seam — {@see validateConcurrency()} —
 * is provided so that layer can reject a stale write before any persistence
 * occurs, without otherwise altering this controller.
 */
final class VaultController
{
    /**
     * REST namespace for all blind-sync endpoints (Requirement 6.1).
     */
    public const NAMESPACE = 'complex-patient/v1';

    /**
     * Recognized vault partitions (design: VaultType union). Any other value
     * is rejected as an unrecognized vault_type (Requirement 6.6).
     *
     * @var list<string>
     */
    public const VAULT_TYPES = [
        'medications',
        'symptoms',
        'conditions',
        'flares',
        'associations',
        'locationTrail',
    ];

    /**
     * Required encrypted envelope fields on a write. Each must be present and
     * non-empty or the entire write is rejected (Requirements 4.7, 6.8).
     *
     * @var list<string>
     */
    private const REQUIRED_ENVELOPE_FIELDS = ['iv', 'auth_tag', 'ciphertext'];

    public function __construct(
        private readonly VaultRepository $repository,
        private readonly AuthMiddleware $auth,
        private readonly ?VaultUpdateNotifier $notifier = null
    ) {
    }

    /**
     * Bind route registration to the WordPress `rest_api_init` hook
     * (Requirement 6.5). Call once during plugin bootstrap.
     */
    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    /**
     * Register the GET and POST vault routes (Requirements 6.1, 6.5).
     *
     * Both methods share the same `{vault_type}` resource and the same
     * permission callback, so auth is enforced uniformly before any handler
     * runs.
     */
    /**
     * Sub-paths under /vault/ owned by dedicated controllers (not vault partitions).
     *
     * @var list<string>
     */
    private const RESERVED_VAULT_SUBPATHS = ['kdf-material', 'paper-backups'];

    public function registerRoutes(): void
    {
        register_rest_route(
            self::NAMESPACE,
            '/vault/(?P<vault_type>(?!' . implode('|', self::RESERVED_VAULT_SUBPATHS) . ')[a-zA-Z0-9_-]+)',
            [
                [
                    'methods'             => 'GET',
                    'callback'            => [$this, 'handleGet'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
                [
                    'methods'             => 'POST',
                    'callback'            => [$this, 'handlePost'],
                    'permission_callback' => [$this->auth, 'permissionCallback'],
                ],
            ]
        );
    }

    /**
     * GET /vault/{vault_type}
     *
     * Returns the blind envelope for the recognized vault_type scoped to the
     * authenticated user (Requirement 6.2), or a not-found indication when no
     * blob exists for that pair (Requirement 6.7). An unrecognized vault_type
     * is rejected without any read (Requirement 6.6).
     *
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handleGet($request)
    {
        $vaultType = $this->resolveVaultType($request);
        if (! $this->isRecognizedVaultType($vaultType)) {
            return $this->unrecognizedVaultTypeError($vaultType);
        }

        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            // Auth failed at the handler boundary; perform no read (Req 4.3).
            return $userId;
        }

        $blob = $this->repository->find($userId, $vaultType);

        if (null === $blob) {
            // Requirement 6.7: no stored data for this user/partition.
            return new \WP_Error(
                'complex_patient_vault_not_found',
                sprintf('No vault data exists for vault_type "%s".', $vaultType),
                ['status' => 404]
            );
        }

        // Requirement 6.2 / 4.6: return only the blind envelope.
        return new \WP_REST_Response(
            [
                'sync_version' => $blob['sync_version'],
                'iv'           => $blob['iv'],
                'auth_tag'     => $blob['auth_tag'],
                'ciphertext'   => $blob['ciphertext'],
            ],
            200
        );
    }

    /**
     * POST /vault/{vault_type}
     *
     * Validates the recognized vault_type (Requirement 6.6) and the presence
     * of every required encrypted field (Requirements 4.7, 6.8), then persists
     * the envelope, setting server_updated_at and the resulting sync_version
     * (Requirements 6.3, 6.4). Nothing is persisted when validation fails.
     *
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function handlePost($request)
    {
        $vaultType = $this->resolveVaultType($request);
        if (! $this->isRecognizedVaultType($vaultType)) {
            return $this->unrecognizedVaultTypeError($vaultType);
        }

        $userId = $this->resolveUserId($request);
        if (! is_int($userId)) {
            return $userId;
        }

        // Requirements 4.7 / 6.8: reject a write missing any required encrypted
        // field, identifying the missing field, and persist nothing.
        $missing = $this->firstMissingEnvelopeField($request);
        if (null !== $missing) {
            return new \WP_Error(
                'complex_patient_missing_field',
                sprintf('The required encrypted field "%s" is missing or empty.', $missing),
                ['status' => 400, 'field' => $missing]
            );
        }

        $existing = $this->repository->find($userId, $vaultType);

        // Extension seam for task 6.5 (optimistic concurrency). The default
        // implementation imposes no version constraint; 6.5 will reject stale
        // writes here with HTTP 409 before any persistence occurs.
        $concurrencyError = $this->validateConcurrency($request, $existing);
        if (null !== $concurrencyError) {
            return $concurrencyError;
        }

        $iv             = (string) $request->get_param('iv');
        $authTag        = (string) $request->get_param('auth_tag');
        $ciphertext     = (string) $request->get_param('ciphertext');
        $clientUpdated  = $this->resolveClientUpdatedAt($request);
        $serverUpdated  = $this->serverNow();

        if (null === $existing) {
            // Requirement 7.4: initial write establishes sync_version = 1.
            $newVersion = 1;
            $this->repository->insert(
                $userId,
                $vaultType,
                $iv,
                $authTag,
                $ciphertext,
                $newVersion,
                $clientUpdated,
                $serverUpdated
            );
        } else {
            // Requirement 6.4: persisting an update increments the stored
            // sync_version by 1.
            $newVersion = (int) $existing['sync_version'] + 1;
            $this->repository->update(
                $userId,
                $vaultType,
                $iv,
                $authTag,
                $ciphertext,
                $newVersion,
                $clientUpdated,
                $serverUpdated
            );
        }

        $originatingDeviceId = $this->resolveOriginatingDeviceId($request);

        try {
            $this->notifier?->notifyVaultUpdated($userId, $vaultType, $newVersion, $originatingDeviceId);
        } catch (\Throwable $exception) {
            if (function_exists('error_log')) {
                error_log(
                    '[Complex Patient] vault push notification fan-out failed: '
                    . $exception->getMessage()
                );
            }
        }

        // Requirement 6.3 / 7.5: confirm persistence with the resulting version.
        return new \WP_REST_Response(['sync_version' => $newVersion], 200);
    }

    /**
     * Optional client device id sent on vault writes to exclude self from push fan-out.
     */
    private function resolveOriginatingDeviceId($request): ?string
    {
        $header = $request->get_header('x_device_id');
        if (is_string($header) && '' !== $header && strlen($header) <= 64) {
            return $header;
        }

        $param = $request->get_param('device_id');
        if (is_string($param) && '' !== $param && strlen($param) <= 64) {
            return $param;
        }

        return null;
    }

    /**
     * Optimistic concurrency control (Requirement 7).
     *
     * Compares the request's supplied `sync_version` against the version
     * currently stored for this user / vault_type and decides whether the
     * write may proceed. A non-existent blob is treated as stored version 0,
     * so the comparison is uniform across initial and subsequent writes:
     * the client must supply the exact version it intends to overwrite
     * (Requirement 7.1).
     *
     * Outcomes:
     *  - Missing `sync_version`, or a value that is not a non-negative integer:
     *    a validation error (HTTP 400) is returned and nothing is persisted
     *    (Requirement 7.6).
     *  - Supplied version != current stored version: an HTTP 409 Conflict is
     *    returned carrying the current stored `sync_version`, and the stored
     *    blob/version are left unchanged (Requirements 7.2, 6.8).
     *  - Supplied version == current stored version: null is returned to allow
     *    the caller to persist, which increments the stored version by 1
     *    (initial write → 1) (Requirements 7.3, 7.4, 7.5).
     *
     * Because this runs before any persistence in {@see handlePost()}, a
     * rejected write never reads-modifies-writes the stored blob.
     *
     * @param \WP_REST_Request                                                           $request
     * @param array{sync_version:int, iv:string, auth_tag:string, ciphertext:string}|null $existing
     * @return \WP_Error|null
     */
    protected function validateConcurrency($request, ?array $existing)
    {
        // Requirement 7.6: sync_version must be present and a non-negative
        // integer; otherwise reject with a validation error and persist
        // nothing.
        $suppliedVersion = $this->normalizeSyncVersion($request->get_param('sync_version'));
        if (null === $suppliedVersion) {
            return new \WP_Error(
                'complex_patient_invalid_sync_version',
                'A non-negative integer "sync_version" is required.',
                ['status' => 400, 'field' => 'sync_version']
            );
        }

        // A non-existent blob is conceptually stored version 0 (nothing to
        // overwrite). This unifies the initial-write and update cases under a
        // single equality check (Requirements 7.1, 7.4).
        $storedVersion = null === $existing ? 0 : (int) $existing['sync_version'];

        // Requirement 7.2 / 6.8: a mismatched version is a conflict. Reject
        // with HTTP 409, surface the current stored version, and leave the
        // stored blob/version unchanged.
        if ($suppliedVersion !== $storedVersion) {
            return new \WP_Error(
                'complex_patient_sync_version_conflict',
                sprintf(
                    'The supplied sync_version (%d) does not match the stored sync_version (%d).',
                    $suppliedVersion,
                    $storedVersion
                ),
                ['status' => 409, 'sync_version' => $storedVersion]
            );
        }

        // Requirements 7.3 / 7.5: versions match; allow the write to proceed.
        return null;
    }

    /**
     * Coerce a request-supplied sync_version into a validated non-negative
     * integer, or null when the value is absent or not a non-negative integer
     * (Requirements 7.1, 7.6).
     *
     * Accepts genuine integers and canonical non-negative integer strings
     * (e.g. "0", "5"). Rejects null, negative values, floats with a fractional
     * part, booleans, and any non-numeric or non-canonical string.
     *
     * @param mixed $value
     */
    private function normalizeSyncVersion($value): ?int
    {
        if (is_int($value)) {
            return $value >= 0 ? $value : null;
        }

        // Reject booleans explicitly: is_int() already excludes them, but they
        // would otherwise slip through any loose numeric handling below.
        if (is_bool($value) || null === $value) {
            return null;
        }

        // Accept only canonical non-negative integer strings ("0", "1", "42").
        // This rejects "-1", "1.5", "1e3", " 3 ", "abc", and "".
        if (is_string($value) && 1 === preg_match('/^\d+$/', $value)) {
            return (int) $value;
        }

        return null;
    }

    /**
     * Extract the vault_type path segment from the request.
     *
     * @param \WP_REST_Request $request
     */
    private function resolveVaultType($request): string
    {
        $value = $request->get_param('vault_type');

        return null === $value ? '' : (string) $value;
    }

    private function isRecognizedVaultType(string $vaultType): bool
    {
        return in_array($vaultType, self::VAULT_TYPES, true);
    }

    /**
     * Build the rejection for an unrecognized vault_type (Requirement 6.6).
     * No storage is read or written before this is returned.
     */
    private function unrecognizedVaultTypeError(string $vaultType): \WP_Error
    {
        return new \WP_Error(
            'complex_patient_unrecognized_vault_type',
            sprintf('"%s" is not a recognized vault_type.', $vaultType),
            ['status' => 400]
        );
    }

    /**
     * Resolve the caller-scoped wp_user_id, re-deriving it through the auth
     * middleware so the handler is scoped exactly as the permission callback
     * authorized it (Requirements 4.2, 4.4). On the (defensive) chance auth no
     * longer holds, returns the corresponding WP_Error instead of an id.
     *
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
                    'Authentication is required to access the vault.',
                    ['status' => 401]
                );
        }

        return $result->userId();
    }

    /**
     * Return the first required encrypted field that is missing or empty, or
     * null when all required fields are present (Requirements 4.7, 6.8).
     *
     * @param \WP_REST_Request $request
     */
    private function firstMissingEnvelopeField($request): ?string
    {
        foreach (self::REQUIRED_ENVELOPE_FIELDS as $field) {
            $value = $request->get_param($field);

            if (null === $value || '' === (string) $value) {
                return $field;
            }
        }

        return null;
    }

    /**
     * Optional client-side operational timestamp accompanying the write.
     *
     * @param \WP_REST_Request $request
     */
    private function resolveClientUpdatedAt($request): ?string
    {
        $value = $request->get_param('client_updated_at');

        if (null === $value || '' === (string) $value) {
            return null;
        }

        return (string) $value;
    }

    /**
     * Server time of persistence, stored in server_updated_at (Requirement
     * 6.4). Uses WordPress' GMT clock when available.
     */
    private function serverNow(): string
    {
        if (function_exists('current_time')) {
            return (string) current_time('mysql', true);
        }

        return gmdate('Y-m-d H:i:s');
    }
}
