<?php

declare(strict_types=1);

namespace ComplexPatient\Account\Blocks;

use ComplexPatient\Account\AccountRedirects;
use ComplexPatient\Account\AccountUi;
use ComplexPatient\Account\ApplicationPasswordService;
use ComplexPatient\Account\RegistrationService;

final class ApplicationPasswordsBlock
{
    public static function render(): string
    {
        if ( ! is_user_logged_in() ) {
            return self::renderLoginRequired();
        }

        if ( ! ApplicationPasswordService::isAvailable() ) {
            return self::renderUnavailable();
        }

        return self::renderManager( get_current_user_id() );
    }

    private static function renderLoginRequired(): string
    {
        ob_start();
        echo AccountUi::wrapStart( 'app-passwords-login' );
        ?>
        <div class="cp-account__card">
            <?php echo AccountUi::renderTitleIfNeeded( __( 'Application passwords', 'complex-patient' ), 'complex_patient_app_passwords_page_id' ); ?>
            <p class="cp-account__lede">
                <?php esc_html_e( 'Sign in to create and manage passwords for apps and devices that connect to your account.', 'complex-patient' ); ?>
            </p>
            <a class="cp-account__button cp-account__button--primary" href="<?php echo esc_url( wp_login_url( get_permalink() ) ); ?>">
                <?php esc_html_e( 'Log in', 'complex-patient' ); ?>
            </a>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }

    private static function renderUnavailable(): string
    {
        ob_start();
        echo AccountUi::wrapStart( 'app-passwords-unavailable' );
        ?>
        <div class="cp-account__card">
            <?php echo AccountUi::renderTitleIfNeeded( __( 'Application passwords', 'complex-patient' ), 'complex_patient_app_passwords_page_id' ); ?>
            <p><?php esc_html_e( 'Application passwords are not available on this site.', 'complex-patient' ); ?></p>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }

    private static function renderManager( int $userId ): string
    {
        $user      = get_userdata( $userId );
        $passwords = ApplicationPasswordService::listForUser( $userId );
        $onboarding = isset( $_GET['onboarding'] ) && $_GET['onboarding'] === '1';
        $flash   = AccountRedirects::consumeFormState( 'app_passwords' );
        $message = is_array( $flash ) ? (string) ( $flash['message'] ?? '' ) : '';

        ob_start();
        echo AccountUi::wrapStart( 'app-passwords' );
        ?>
        <div class="cp-account__card">
            <?php echo AccountUi::renderTitleIfNeeded( __( 'Application passwords', 'complex-patient' ), 'complex_patient_app_passwords_page_id' ); ?>
            <p class="cp-account__lede">
                <?php esc_html_e( 'Passwords for apps and devices that connect to your account, including the Complex Patient mobile app. These are not your site login password.', 'complex-patient' ); ?>
            </p>

            <?php if ( $onboarding ) : ?>
                <p class="cp-account__message" role="status">
                    <?php esc_html_e( 'Create a password for the Complex Patient app. Name it after your device so you can tell passwords apart.', 'complex-patient' ); ?>
                </p>
            <?php endif; ?>

            <?php if ( $message !== '' ) : ?>
                <p class="cp-account__message cp-account__message--error" role="alert"><?php echo esc_html( $message ); ?></p>
            <?php endif; ?>

            <?php if ( isset( $_GET['revoked'] ) && $_GET['revoked'] === '1' ) : ?>
                <p class="cp-account__message cp-account__message--success" role="status">
                    <?php esc_html_e( 'Application password revoked.', 'complex-patient' ); ?>
                </p>
            <?php endif; ?>

            <?php echo AccountUi::renderAppPasswordSuccess( $userId ); ?>

            <form class="cp-account__form cp-account__form--inline" method="post" action="">
                <input type="hidden" name="complex_patient_action" value="<?php echo esc_attr( RegistrationService::ACTION_APP_PW . '_create' ); ?>" />
                <?php wp_nonce_field( RegistrationService::ACTION_APP_PW . '_create', '_cp_nonce' ); ?>
                <label class="cp-account__field">
                    <span class="cp-account__label"><?php esc_html_e( 'New application password name', 'complex-patient' ); ?></span>
                    <input type="text" name="app_password_name" required
                        placeholder="<?php esc_attr_e( 'Complex Patient – iPhone', 'complex-patient' ); ?>" />
                </label>
                <button type="submit" class="cp-account__button cp-account__button--primary">
                    <?php esc_html_e( 'Create application password', 'complex-patient' ); ?>
                </button>
            </form>

            <?php if ( $passwords === array() ) : ?>
                <p class="cp-account__hint"><?php esc_html_e( 'You have no application passwords yet.', 'complex-patient' ); ?></p>
            <?php else : ?>
                <table class="cp-account__table">
                    <thead>
                        <tr>
                            <th><?php esc_html_e( 'Name', 'complex-patient' ); ?></th>
                            <th><?php esc_html_e( 'Created', 'complex-patient' ); ?></th>
                            <th><?php esc_html_e( 'Last used', 'complex-patient' ); ?></th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ( $passwords as $row ) : ?>
                            <tr>
                                <td><?php echo esc_html( (string) ( $row['name'] ?? '' ) ); ?></td>
                                <td><?php echo esc_html( self::formatDate( $row['created'] ?? '' ) ); ?></td>
                                <td><?php echo esc_html( self::formatDate( $row['last_used'] ?? '' ) ); ?></td>
                                <td>
                                    <form method="post" action="" class="cp-account__inline-form">
                                        <input type="hidden" name="complex_patient_action" value="<?php echo esc_attr( RegistrationService::ACTION_APP_PW . '_revoke' ); ?>" />
                                        <input type="hidden" name="app_password_uuid" value="<?php echo esc_attr( (string) ( $row['uuid'] ?? '' ) ); ?>" />
                                        <?php wp_nonce_field( RegistrationService::ACTION_APP_PW . '_revoke', '_cp_nonce' ); ?>
                                        <button type="submit" class="cp-account__button cp-account__button--danger">
                                            <?php esc_html_e( 'Revoke', 'complex-patient' ); ?>
                                        </button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>

            <?php if ( $user ) : ?>
                <p class="cp-account__hint">
                    <?php
                    printf(
                        /* translators: %s: WordPress username */
                        esc_html__( 'In the Complex Patient app, sign in with username %s and one of these application passwords.', 'complex-patient' ),
                        esc_html( $user->user_login )
                    );
                    ?>
                </p>
            <?php endif; ?>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }

    private static function formatDate( $value ): string
    {
        if ( $value === null || $value === '' ) {
            return '—';
        }

        if ( is_int( $value ) || is_float( $value ) ) {
            return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) $value );
        }

        if ( is_string( $value ) && is_numeric( $value ) ) {
            return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) $value );
        }

        if ( ! is_string( $value ) ) {
            return '—';
        }

        $time = strtotime( $value );
        if ( $time === false ) {
            return '—';
        }

        return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $time );
    }
}
