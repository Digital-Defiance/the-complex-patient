<?php

declare(strict_types=1);

namespace ComplexPatient\Account\Blocks;

use ComplexPatient\Account\AccountRedirects;
use ComplexPatient\Account\AccountSetup;
use ComplexPatient\Account\AccountUi;
use ComplexPatient\Account\BuddyPressRegistration;
use ComplexPatient\Account\JetpackSsoIntegration;
use ComplexPatient\Account\RegistrationService;

final class RegisterBlock
{
    public static function render(): string
    {
        if ( is_user_logged_in() && ! AccountSetup::needsFinishSetup( get_current_user_id() ) ) {
            return self::renderLoggedIn();
        }

        if ( isset( $_GET['registered'] ) && $_GET['registered'] === '1' && is_user_logged_in() ) {
            return self::renderSuccess( get_current_user_id() );
        }

        return self::renderForm();
    }

    private static function renderLoggedIn(): string
    {
        $user = wp_get_current_user();
        ob_start();
        echo AccountUi::wrapStart( 'register' );
        ?>
        <div class="cp-account__card">
            <h2 class="cp-account__title"><?php esc_html_e( 'You are already signed in', 'complex-patient' ); ?></h2>
            <p class="cp-account__lede">
                <?php
                printf(
                    /* translators: %s: username */
                    esc_html__( 'Signed in as %s.', 'complex-patient' ),
                    esc_html( $user->user_login )
                );
                ?>
            </p>
            <div class="cp-account__actions">
                <a class="cp-account__button" href="<?php echo esc_url( BuddyPressRegistration::groupsUrl() ); ?>">
                    <?php esc_html_e( 'Explore groups', 'complex-patient' ); ?>
                </a>
                <a class="cp-account__button cp-account__button--secondary" href="<?php echo esc_url( AccountRedirects::applicationPasswordsUrl() ); ?>">
                    <?php esc_html_e( 'Application passwords', 'complex-patient' ); ?>
                </a>
            </div>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }

    private static function renderSuccess( int $userId ): string
    {
        $user = get_userdata( $userId );
        ob_start();
        echo AccountUi::wrapStart( 'register-success' );
        ?>
        <div class="cp-account__card">
            <h2 class="cp-account__title"><?php esc_html_e( 'Account created', 'complex-patient' ); ?></h2>
            <p class="cp-account__lede">
                <?php esc_html_e( 'Welcome to The Complex Patient. You can join groups and set up the mobile app next.', 'complex-patient' ); ?>
            </p>
            <?php if ( $user ) : ?>
                <p class="cp-account__meta">
                    <?php
                    printf(
                        /* translators: 1: username 2: email */
                        esc_html__( 'Username: %1$s · Email: %2$s', 'complex-patient' ),
                        esc_html( $user->user_login ),
                        esc_html( $user->user_email )
                    );
                    ?>
                </p>
            <?php endif; ?>
            <?php echo AccountUi::renderAppPasswordSuccess( $userId ); ?>
            <div class="cp-account__actions">
                <a class="cp-account__button" href="<?php echo esc_url( BuddyPressRegistration::groupsUrl() ); ?>">
                    <?php esc_html_e( 'Explore groups', 'complex-patient' ); ?>
                </a>
                <a class="cp-account__button cp-account__button--secondary" href="<?php echo esc_url( AccountUi::secureAppUrl() ); ?>">
                    <?php esc_html_e( 'Open secure app', 'complex-patient' ); ?>
                </a>
            </div>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }

    private static function renderForm(): string
    {
        if ( ! get_option( 'users_can_register' ) ) {
            ob_start();
            echo AccountUi::wrapStart( 'register-disabled' );
            ?>
            <div class="cp-account__card">
                <p><?php esc_html_e( 'Registration is currently closed.', 'complex-patient' ); ?></p>
            </div>
            <?php
            echo AccountUi::wrapEnd();
            return (string) ob_get_clean();
        }

        $flash       = AccountRedirects::consumeFormState( 'register' );
        $fieldErrors = is_array( $flash['field_errors'] ?? null ) ? $flash['field_errors'] : array();
        $values      = array_merge(
            array(
                'display_name' => '',
                'username'     => '',
                'email'        => '',
            ),
            is_array( $flash['values'] ?? null ) ? $flash['values'] : array()
        );
        $message = is_array( $flash ) ? (string) ( $flash['message'] ?? '' ) : '';

        ob_start();
        echo AccountUi::wrapStart( 'register' );
        ?>
        <div class="cp-account__card">
            <h2 class="cp-account__title"><?php esc_html_e( 'Create your account', 'complex-patient' ); ?></h2>
            <p class="cp-account__lede">
                <?php esc_html_e( 'Join The Complex Patient to connect with groups and sync the encrypted mobile app.', 'complex-patient' ); ?>
            </p>

            <?php if ( $message !== '' ) : ?>
                <p class="cp-account__message cp-account__message--error" role="alert"><?php echo esc_html( $message ); ?></p>
            <?php endif; ?>

            <form class="cp-account__form" method="post" action="">
                <input type="hidden" name="complex_patient_action" value="<?php echo esc_attr( RegistrationService::ACTION_REGISTER ); ?>" />
                <?php wp_nonce_field( RegistrationService::ACTION_REGISTER, '_cp_nonce' ); ?>

                <label class="cp-account__field">
                    <span class="cp-account__label"><?php esc_html_e( 'Display name', 'complex-patient' ); ?></span>
                    <input type="text" name="display_name" required autocomplete="name"
                        value="<?php echo esc_attr( (string) ( $values['display_name'] ?? '' ) ); ?>" />
                    <span class="cp-account__help"><?php esc_html_e( 'How your name appears in groups.', 'complex-patient' ); ?></span>
                    <?php echo AccountUi::fieldError( $fieldErrors, 'display_name' ); ?>
                </label>

                <label class="cp-account__field">
                    <span class="cp-account__label"><?php esc_html_e( 'Username', 'complex-patient' ); ?></span>
                    <input type="text" name="username" required autocomplete="username"
                        value="<?php echo esc_attr( (string) ( $values['username'] ?? '' ) ); ?>" />
                    <span class="cp-account__help"><?php esc_html_e( 'Use this to sign in to the app (and mobile app).', 'complex-patient' ); ?></span>
                    <?php echo AccountUi::fieldError( $fieldErrors, 'username' ); ?>
                </label>

                <label class="cp-account__field">
                    <span class="cp-account__label"><?php esc_html_e( 'Email', 'complex-patient' ); ?></span>
                    <input type="email" name="email" required autocomplete="email"
                        value="<?php echo esc_attr( (string) ( $values['email'] ?? '' ) ); ?>" />
                    <?php echo AccountUi::fieldError( $fieldErrors, 'email' ); ?>
                </label>

                <label class="cp-account__field">
                    <span class="cp-account__label"><?php esc_html_e( 'Password', 'complex-patient' ); ?></span>
                    <input type="password" name="password" required autocomplete="new-password" />
                    <?php echo AccountUi::fieldError( $fieldErrors, 'password' ); ?>
                </label>

                <?php echo AccountUi::privacyCheckbox( ! empty( $values['privacy_policy'] ) ); ?>
                <?php echo AccountUi::fieldError( $fieldErrors, 'privacy_policy' ); ?>

                <?php echo AccountUi::appPasswordCheckbox( true ); ?>

                <button type="submit" class="cp-account__button cp-account__button--primary">
                    <?php esc_html_e( 'Create account', 'complex-patient' ); ?>
                </button>
            </form>

            <?php if ( JetpackSsoIntegration::isAvailable() ) : ?>
                <div class="cp-account__divider"><span><?php esc_html_e( 'or', 'complex-patient' ); ?></span></div>
                <a class="cp-account__button cp-account__button--wpcom" href="<?php echo esc_url( JetpackSsoIntegration::getSsoUrl() ); ?>">
                    <?php esc_html_e( 'Continue with WordPress.com', 'complex-patient' ); ?>
                </a>
                <p class="cp-account__hint">
                    <?php esc_html_e( 'You will confirm your profile and app password on the next step.', 'complex-patient' ); ?>
                </p>
            <?php endif; ?>

            <p class="cp-account__footer">
                <?php esc_html_e( 'Already have an account?', 'complex-patient' ); ?>
                <a class="cp-account__link" href="<?php echo esc_url( wp_login_url() ); ?>"><?php esc_html_e( 'Log in', 'complex-patient' ); ?></a>
            </p>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }
}
