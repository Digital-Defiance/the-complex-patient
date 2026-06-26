<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

/**
 * Shared markup helpers for account blocks.
 */
final class AccountUi
{
    public static function privacyPolicyUrl(): string
    {
        $page = get_page_by_path( 'privacy-policy' );
        if ( $page instanceof \WP_Post ) {
            $url = get_permalink( $page );
            if ( is_string( $url ) && $url !== '' ) {
                return $url;
            }
        }

        return home_url( '/privacy/' );
    }

    public static function secureAppUrl(): string
    {
        return home_url( '/secure/' );
    }

    /**
     * @param array<string, string> $fieldErrors
     */
    public static function fieldError( array $fieldErrors, string $key ): string
    {
        if ( empty( $fieldErrors[ $key ] ) ) {
            return '';
        }

        return '<p class="cp-account__field-error" role="alert">' . esc_html( $fieldErrors[ $key ] ) . '</p>';
    }

    public static function wrapStart( string $modifier = '' ): string
    {
        $class = 'cp-account';
        if ( $modifier !== '' ) {
            $class .= ' cp-account--' . sanitize_html_class( $modifier );
        }

        return '<div class="' . esc_attr( $class ) . '">';
    }

    public static function wrapEnd(): string
    {
        return '</div>';
    }

    /**
     * Skip the card heading on plugin account pages that already have a page title.
     */
    public static function renderTitleIfNeeded( string $title, ?string $dedicatedPageOption = null ): string
    {
        if ( $dedicatedPageOption !== null && self::isDedicatedAccountPage( $dedicatedPageOption ) ) {
            return '';
        }

        if ( self::pageAlreadyShowsTitle( $title ) ) {
            return '';
        }

        return '<h2 class="cp-account__title">' . esc_html( $title ) . '</h2>';
    }

    public static function isDedicatedAccountPage( string $optionKey ): bool
    {
        $pageId = (int) get_option( $optionKey, 0 );

        return $pageId > 0 && is_page( $pageId );
    }

    private static function pageAlreadyShowsTitle( string $title ): bool
    {
        $postId = get_the_ID();
        if ( ! $postId ) {
            $post = get_queried_object();
            $postId = $post instanceof \WP_Post ? (int) $post->ID : 0;
        }

        if ( $postId <= 0 ) {
            return false;
        }

        return strcasecmp( trim( get_the_title( $postId ) ), trim( $title ) ) === 0;
    }

    /**
     * @return array<string, mixed>
     */
    public static function valuesFromFlash( string $context, array $defaults = array() ): array
    {
        $flash = AccountRedirects::consumeFormState( $context );
        if ( $flash === null ) {
            return $defaults;
        }

        return array_merge( $defaults, is_array( $flash['values'] ?? null ) ? $flash['values'] : array() );
    }

    /** @deprecated Use a single consumeFormState() call per request. */
    public static function fieldErrorsFromFlash( string $context ): array
    {
        $flash = AccountRedirects::consumeFormState( $context );
        if ( $flash === null ) {
            return array();
        }

        return is_array( $flash['field_errors'] ?? null ) ? $flash['field_errors'] : array();
    }

    /** @deprecated Use a single consumeFormState() call per request. */
    public static function flashMessage( string $context ): string
    {
        $flash = AccountRedirects::consumeFormState( $context );
        if ( $flash === null || empty( $flash['message'] ) ) {
            return '';
        }

        return (string) $flash['message'];
    }

    public static function renderAppPasswordSuccess( int $userId ): string
    {
        $flash = AccountSetup::consumeNewApplicationPasswordFlash( $userId );
        if ( $flash === null ) {
            return '';
        }

        ob_start();
        ?>
        <div class="cp-account__success cp-account__success--app-password" role="status">
            <h3><?php esc_html_e( 'Your application password', 'complex-patient' ); ?></h3>
            <p><?php esc_html_e( 'Copy this now. It will not be shown again.', 'complex-patient' ); ?></p>
            <code class="cp-account__secret"><?php echo esc_html( $flash['password'] ); ?></code>
            <p class="cp-account__hint">
                <?php esc_html_e( 'In the Complex Patient app, sign in with your WordPress username and this application password — not your regular login password.', 'complex-patient' ); ?>
            </p>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    public static function appPasswordCheckbox( bool $checked = true ): string
    {
        ob_start();
        ?>
        <label class="cp-account__checkbox">
            <input type="checkbox" name="create_app_password" value="1" <?php checked( $checked ); ?> />
            <span class="cp-account__checkbox-copy">
                <strong><?php esc_html_e( 'Create an application password for the mobile app', 'complex-patient' ); ?></strong>
                <span class="cp-account__checkbox-help">
                    <?php esc_html_e( 'Recommended. The mobile app uses this password to get access from WordPress and retrieve your vault data. Required if you want to use the mobile app.', 'complex-patient' ); ?>
                </span>
            </span>
        </label>
        <?php
        return (string) ob_get_clean();
    }

    public static function privacyCheckbox( bool $checked = false ): string
    {
        $url = self::privacyPolicyUrl();
        ob_start();
        ?>
        <label class="cp-account__checkbox">
            <input type="checkbox" name="privacy_policy" value="1" <?php checked( $checked ); ?> required />
            <span class="cp-account__checkbox-label">
                <?php esc_html_e( 'I agree to the', 'complex-patient' ); ?>
                <a class="cp-account__link" href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener noreferrer">
                    <?php esc_html_e( 'Privacy Policy', 'complex-patient' ); ?>
                </a>.
            </span>
        </label>
        <?php
        return (string) ob_get_clean();
    }
}
