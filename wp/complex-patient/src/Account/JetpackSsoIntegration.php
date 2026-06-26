<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

/**
 * Jetpack SSO hooks and helpers.
 */
final class JetpackSsoIntegration
{
    public static function register(): void
    {
        add_action( 'user_register', array( self::class, 'onUserRegister' ), 20, 1 );
        add_action( 'template_redirect', array( self::class, 'maybeRedirectToFinishSetup' ), 9 );
        add_action( 'bp_template_redirect', array( self::class, 'maybeRedirectToFinishSetup' ), 1 );
    }

    public static function isAvailable(): bool
    {
        return class_exists( '\Automattic\Jetpack\Connection\SSO\SSO' )
            || class_exists( 'Jetpack_SSO' );
    }

    public static function finishSetupUrl(): string
    {
        $pageId = (int) get_option( 'complex_patient_finish_page_id', 0 );
        if ( $pageId > 0 ) {
            $url = get_permalink( $pageId );
            if ( is_string( $url ) && $url !== '' ) {
                return $url;
            }
        }

        return home_url( '/join/finish/' );
    }

    public static function joinUrl(): string
    {
        $pageId = (int) get_option( 'complex_patient_join_page_id', 0 );
        if ( $pageId > 0 ) {
            $url = get_permalink( $pageId );
            if ( is_string( $url ) && $url !== '' ) {
                return $url;
            }
        }

        return home_url( '/join/' );
    }

    public static function getSsoUrl( ?string $redirectTo = null ): string
    {
        $redirectTo = $redirectTo ?? self::finishSetupUrl();

        if ( class_exists( '\Automattic\Jetpack\Connection\SSO\SSO' ) ) {
            $sso = \Automattic\Jetpack\Connection\SSO\SSO::get_instance();

            return $sso->build_sso_button_url(
                array(
                    'redirect_to' => rawurlencode( $redirectTo ),
                )
            );
        }

        return add_query_arg(
            array(
                'action'      => 'jetpack-sso',
                'redirect_to' => rawurlencode( $redirectTo ),
            ),
            wp_login_url()
        );
    }

    public static function onUserRegister( int $userId ): void
    {
        if ( get_user_meta( $userId, 'wpcom_user_id', true ) ) {
            AccountSetup::markNeedsFinishSetup( $userId );
        }
    }

    public static function maybeRedirectToFinishSetup(): void
    {
        if ( ! is_user_logged_in() || is_admin() ) {
            return;
        }

        $userId = get_current_user_id();
        if ( ! AccountSetup::needsFinishSetup( $userId ) ) {
            return;
        }

        if ( self::isFinishSetupRequest() ) {
            return;
        }

        wp_safe_redirect( self::finishSetupUrl() );
        exit;
    }

    public static function isFinishSetupRequest(): bool
    {
        if ( is_page() ) {
            $finishId = (int) get_option( 'complex_patient_finish_page_id', 0 );
            if ( $finishId > 0 && is_page( $finishId ) ) {
                return true;
            }
        }

        $path = isset( $_SERVER['REQUEST_URI'] )
            ? (string) wp_parse_url( (string) $_SERVER['REQUEST_URI'], PHP_URL_PATH )
            : '';

        return str_contains( $path, '/join/finish' );
    }
}
