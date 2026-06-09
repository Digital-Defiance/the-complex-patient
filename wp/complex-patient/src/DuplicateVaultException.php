<?php

declare(strict_types=1);

namespace ComplexPatient;

/**
 * Raised when an insert would violate the UNIQUE KEY on
 * (wp_user_id, vault_type), i.e. a current blob already exists for that
 * combination.
 *
 * Implements Requirement 9.6: the offending operation is rejected, the
 * duplicate (wp_user_id, vault_type) combination is identified, and the
 * existing stored row is preserved unchanged (the repository never issues a
 * write when this is thrown).
 */
final class DuplicateVaultException extends \RuntimeException
{
    public function __construct(
        public readonly int $wpUserId,
        public readonly string $vaultType,
        ?\Throwable $previous = null
    ) {
        parent::__construct(
            sprintf(
                'A vault blob already exists for the (wp_user_id, vault_type) combination (%d, "%s"); the existing row was preserved.',
                $wpUserId,
                $vaultType
            ),
            0,
            $previous
        );
    }
}
