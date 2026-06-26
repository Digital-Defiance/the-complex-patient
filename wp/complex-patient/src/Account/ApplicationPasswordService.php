<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

use WP_Error;

/**
 * Thin wrapper around WordPress core Application Passwords APIs.
 */
final class ApplicationPasswordService
{
    public static function isAvailable(): bool
    {
        return function_exists( 'wp_is_application_passwords_available' )
            && wp_is_application_passwords_available();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function listForUser( int $userId ): array
    {
        if ( ! self::isAvailable() || ! class_exists( 'WP_Application_Passwords' ) ) {
            return array();
        }

        $passwords = \WP_Application_Passwords::get_user_application_passwords( $userId );

        return is_array( $passwords ) ? $passwords : array();
    }

    /**
     * @return array{uuid: string, password: string, name: string}|WP_Error
     */
    public static function createForUser( int $userId, string $name )
    {
        if ( ! self::isAvailable() ) {
            return new WP_Error(
                'app_passwords_unavailable',
                __( 'Application passwords are not available on this site.', 'complex-patient' )
            );
        }

        $name = sanitize_text_field( $name );
        if ( $name === '' ) {
            $name = __( 'Mobile app', 'complex-patient' );
        }

        $created = \WP_Application_Passwords::create_new_application_password(
            $userId,
            array( 'name' => $name )
        );

        if ( is_wp_error( $created ) ) {
            return $created;
        }

        if ( ! is_array( $created ) ) {
            return new WP_Error(
                'app_password_create_failed',
                __( 'Could not create an application password.', 'complex-patient' )
            );
        }

        return self::mapCreatedPassword( $created, $name );
    }

    /**
     * WordPress returns [ plain_text_password, password_item_array ].
     *
     * @param array<int, mixed> $created
     * @return array{uuid: string, password: string, name: string}|WP_Error
     */
    public static function mapCreatedPassword( array $created, string $name )
    {
        if ( count( $created ) < 2 || ! is_string( $created[0] ) || ! is_array( $created[1] ) ) {
            return new WP_Error(
                'app_password_create_failed',
                __( 'Could not create an application password.', 'complex-patient' )
            );
        }

        return array(
            'uuid'     => (string) ( $created[1]['uuid'] ?? '' ),
            'password' => self::formatForDisplay( (string) $created[0] ),
            'name'     => $name,
        );
    }

    public static function formatForDisplay( string $password ): string
    {
        if ( class_exists( 'WP_Application_Passwords' ) ) {
            return \WP_Application_Passwords::chunk_password( $password );
        }

        $normalized = preg_replace( '/[^a-z\d]/i', '', $password ) ?? '';

        return trim( chunk_split( $normalized, 4, ' ' ) );
    }

    /**
     * @return true|WP_Error
     */
    public static function revokeForUser( int $userId, string $uuid )
    {
        if ( ! self::isAvailable() ) {
            return new WP_Error(
                'app_passwords_unavailable',
                __( 'Application passwords are not available on this site.', 'complex-patient' )
            );
        }

        $deleted = \WP_Application_Passwords::delete_application_password( $userId, $uuid );

        if ( ! $deleted ) {
            return new WP_Error(
                'app_password_revoke_failed',
                __( 'Could not revoke that application password.', 'complex-patient' )
            );
        }

        return true;
    }
}
