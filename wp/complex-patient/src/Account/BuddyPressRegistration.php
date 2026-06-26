<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

/**
 * Keeps BuddyPress member profiles in sync after WordPress user creation.
 */
final class BuddyPressRegistration
{
    public static function isActive(): bool
    {
        return function_exists( 'buddypress' ) && function_exists( 'bp_is_active' );
    }

    public static function syncDisplayName( int $userId, string $displayName ): void
    {
        $displayName = sanitize_text_field( $displayName );
        if ( $displayName === '' ) {
            return;
        }

        wp_update_user(
            array(
                'ID'           => $userId,
                'display_name' => $displayName,
            )
        );

        if ( ! self::isActive() || ! bp_is_active( 'xprofile' ) ) {
            return;
        }

        if ( ! function_exists( 'xprofile_set_field_data' ) || ! function_exists( 'bp_xprofile_fullname_field_id' ) ) {
            return;
        }

        $fieldId = (int) bp_xprofile_fullname_field_id();
        if ( $fieldId > 0 ) {
            xprofile_set_field_data( $fieldId, $userId, $displayName );
        }
    }

    public static function groupsUrl(): string
    {
        if ( self::isActive() && function_exists( 'bp_get_groups_directory_permalink' ) ) {
            $url = bp_get_groups_directory_permalink();
            if ( is_string( $url ) && $url !== '' ) {
                return $url;
            }
        }

        return home_url( '/groups/' );
    }
}
