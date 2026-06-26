<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

/**
 * Creates default account pages on activation when missing.
 */
final class AccountPages
{
    private const READY_OPTION = 'complex_patient_account_pages_ready';

    public static function register(): void
    {
        add_action( 'init', array( self::class, 'maybeEnsurePages' ), 20 );
    }

    /**
     * Run after WordPress rewrite/query is initialized (not on plugins_loaded).
     */
    public static function maybeEnsurePages(): void
    {
        if ( get_option( self::READY_OPTION, '' ) === COMPLEX_PATIENT_VERSION && self::allPagesReady() ) {
            return;
        }

        self::ensurePages();

        if ( self::allPagesReady() ) {
            update_option( self::READY_OPTION, COMPLEX_PATIENT_VERSION, false );
        }
    }

    /**
     * Force page creation on the next request (e.g. after plugin activation).
     */
    public static function scheduleEnsurePages(): void
    {
        delete_option( self::READY_OPTION );
    }

    public static function ensurePages(): void
    {
        self::ensurePage(
            'complex_patient_join_page_id',
            'join',
            __( 'Join', 'complex-patient' ),
            '<!-- wp:complex-patient/register /-->'
        );

        self::ensurePage(
            'complex_patient_finish_page_id',
            'join/finish',
            __( 'Finish account setup', 'complex-patient' ),
            '<!-- wp:complex-patient/finish-setup /-->'
        );

        self::ensurePage(
            'complex_patient_account_hub_page_id',
            'account',
            __( 'Account', 'complex-patient' ),
            ''
        );

        self::ensurePage(
            'complex_patient_app_passwords_page_id',
            'account/application-passwords',
            __( 'Application passwords', 'complex-patient' ),
            '<!-- wp:complex-patient/application-passwords /-->'
        );
    }

    private static function ensurePage( string $optionKey, string $path, string $title, string $content ): void
    {
        $existingId = (int) get_option( $optionKey, 0 );
        if ( $existingId > 0 && get_post_status( $existingId ) ) {
            return;
        }

        $byPath = get_page_by_path( $path );
        if ( $byPath instanceof \WP_Post ) {
            update_option( $optionKey, $byPath->ID, false );
            return;
        }

        $parentId = self::parentIdForPath( $path );
        if ( $parentId === 0 && str_contains( $path, '/' ) ) {
            // Parent segment missing — create pages in order on a later init pass.
            return;
        }

        $pageId = wp_insert_post(
            array(
                'post_title'   => $title,
                'post_name'    => basename( $path ),
                'post_parent'  => $parentId,
                'post_content' => $content,
                'post_status'  => 'publish',
                'post_type'    => 'page',
            ),
            false
        );

        if ( is_wp_error( $pageId ) || ! $pageId ) {
            return;
        }

        update_option( $optionKey, (int) $pageId, false );
    }

    private static function parentIdForPath( string $path ): int
    {
        $parts = explode( '/', trim( $path, '/' ) );
        if ( count( $parts ) <= 1 ) {
            return 0;
        }

        array_pop( $parts );
        $parentPath = implode( '/', $parts );
        $parent     = get_page_by_path( $parentPath );

        return $parent instanceof \WP_Post ? (int) $parent->ID : 0;
    }

    private static function allPagesReady(): bool
    {
        foreach (
            array(
                'complex_patient_join_page_id',
                'complex_patient_finish_page_id',
                'complex_patient_account_hub_page_id',
                'complex_patient_app_passwords_page_id',
            ) as $optionKey
        ) {
            $pageId = (int) get_option( $optionKey, 0 );
            if ( $pageId <= 0 || ! get_post_status( $pageId ) ) {
                return false;
            }
        }

        return true;
    }
}
