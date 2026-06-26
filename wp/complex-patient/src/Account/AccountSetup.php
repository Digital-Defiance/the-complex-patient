<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

/**
 * Tracks whether a user has completed Complex Patient account onboarding.
 */
final class AccountSetup
{
    public const META_SETUP_COMPLETE = 'complex_patient_account_setup_complete';
    public const META_NEEDS_FINISH   = 'complex_patient_needs_finish_setup';
    public const TRANSIENT_APP_PW    = 'complex_patient_new_app_password';

    public static function isComplete( int $userId ): bool
    {
        return (bool) get_user_meta( $userId, self::META_SETUP_COMPLETE, true );
    }

    public static function needsFinishSetup( int $userId ): bool
    {
        if ( self::isComplete( $userId ) ) {
            return false;
        }

        return (bool) get_user_meta( $userId, self::META_NEEDS_FINISH, true );
    }

    public static function markComplete( int $userId ): void
    {
        update_user_meta( $userId, self::META_SETUP_COMPLETE, '1' );
        delete_user_meta( $userId, self::META_NEEDS_FINISH );
    }

    public static function markNeedsFinishSetup( int $userId ): void
    {
        update_user_meta( $userId, self::META_NEEDS_FINISH, '1' );
    }

    public static function storeNewApplicationPasswordFlash( int $userId, string $password, string $appName ): void
    {
        set_transient(
            self::TRANSIENT_APP_PW . '_' . $userId,
            array(
                'password' => $password,
                'name'     => $appName,
            ),
            15 * MINUTE_IN_SECONDS
        );
    }

    /**
     * @return array{password: string, name: string}|null
     */
    public static function consumeNewApplicationPasswordFlash( int $userId ): ?array
    {
        $key  = self::TRANSIENT_APP_PW . '_' . $userId;
        $data = get_transient( $key );
        delete_transient( $key );

        if ( ! is_array( $data ) || empty( $data['password'] ) ) {
            return null;
        }

        return array(
            'password' => (string) $data['password'],
            'name'     => (string) ( $data['name'] ?? '' ),
        );
    }
}
