<?php

declare(strict_types=1);

namespace ComplexPatient\Account\Blocks;

use ComplexPatient\Account\AccountRedirects;
use ComplexPatient\Account\AccountSetup;
use ComplexPatient\Account\AccountUi;
use ComplexPatient\Account\BuddyPressRegistration;
use ComplexPatient\Account\RegistrationService;

final class FinishSetupBlock
{
    public static function render(): string
    {
        if ( ! is_user_logged_in() ) {
            return self::renderLoginRequired();
        }

        $userId = get_current_user_id();

        if ( isset( $_GET['setup'] ) && $_GET['setup'] === '1' && AccountSetup::isComplete( $userId ) ) {
            return self::renderSuccess( $userId );
        }

        if ( AccountSetup::isComplete( $userId ) && ! AccountSetup::needsFinishSetup( $userId ) ) {
            return self::renderAlreadyComplete( $userId );
        }

        return self::renderForm( $userId );
    }

    private static function renderLoginRequired(): string
    {
        ob_start();
        echo AccountUi::wrapStart( 'finish-login' );
        ?>
        <div class="cp-account__card">
            <h2 class="cp-account__title"><?php esc_html_e( 'Sign in to continue', 'complex-patient' ); ?></h2>
            <p class="cp-account__lede"><?php esc_html_e( 'Finish setting up your account after you sign in.', 'complex-patient' ); ?></p>
            <a class="cp-account__button cp-account__button--primary" href="<?php echo esc_url( wp_login_url( get_permalink() ) ); ?>">
                <?php esc_html_e( 'Log in', 'complex-patient' ); ?>
            </a>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }

    private static function renderAlreadyComplete( int $userId ): string
    {
        return self::renderSuccess( $userId );
    }

    private static function renderSuccess( int $userId ): string
    {
        $user = get_userdata( $userId );
        ob_start();
        echo AccountUi::wrapStart( 'finish-success' );
        ?>
        <div class="cp-account__card">
            <h2 class="cp-account__title"><?php esc_html_e( 'You are all set', 'complex-patient' ); ?></h2>
            <p class="cp-account__lede">
                <?php esc_html_e( 'Your account is ready. Explore groups or manage application passwords any time.', 'complex-patient' ); ?>
            </p>
            <?php if ( $user ) : ?>
                <p class="cp-account__meta">
                    <?php
                    printf(
                        /* translators: 1: display name 2: username */
                        esc_html__( 'Display name: %1$s · Username: %2$s', 'complex-patient' ),
                        esc_html( $user->display_name ),
                        esc_html( $user->user_login )
                    );
                    ?>
                </p>
            <?php endif; ?>
            <?php echo AccountUi::renderAppPasswordSuccess( $userId ); ?>
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

    private static function renderForm( int $userId ): string
    {
        $user        = get_userdata( $userId );
        $flash       = AccountRedirects::consumeFormState( 'finish' );
        $fieldErrors = is_array( $flash['field_errors'] ?? null ) ? $flash['field_errors'] : array();
        $values      = array_merge(
            array(
                'display_name' => $user ? $user->display_name : '',
            ),
            is_array( $flash['values'] ?? null ) ? $flash['values'] : array()
        );
        $message = is_array( $flash ) ? (string) ( $flash['message'] ?? '' ) : '';

        ob_start();
        echo AccountUi::wrapStart( 'finish' );
        ?>
        <div class="cp-account__card">
            <?php echo AccountUi::renderTitleIfNeeded( __( 'Finish account setup', 'complex-patient' ), 'complex_patient_finish_page_id' ); ?>
            <p class="cp-account__lede">
                <?php esc_html_e( 'We imported these details from your WordPress.com account. Confirm how you want to appear in groups.', 'complex-patient' ); ?>
            </p>

            <?php if ( $message !== '' ) : ?>
                <p class="cp-account__message cp-account__message--error" role="alert"><?php echo esc_html( $message ); ?></p>
            <?php endif; ?>

            <form class="cp-account__form" method="post" action="">
                <input type="hidden" name="complex_patient_action" value="<?php echo esc_attr( RegistrationService::ACTION_FINISH ); ?>" />
                <?php wp_nonce_field( RegistrationService::ACTION_FINISH, '_cp_nonce' ); ?>

                <label class="cp-account__field">
                    <span class="cp-account__label"><?php esc_html_e( 'Display name', 'complex-patient' ); ?></span>
                    <input type="text" name="display_name" required autocomplete="name"
                        value="<?php echo esc_attr( (string) ( $values['display_name'] ?? '' ) ); ?>" />
                    <?php echo AccountUi::fieldError( $fieldErrors, 'display_name' ); ?>
                </label>

                <?php if ( $user ) : ?>
                    <div class="cp-account__readonly">
                        <p><strong><?php esc_html_e( 'Username', 'complex-patient' ); ?>:</strong> <?php echo esc_html( $user->user_login ); ?></p>
                        <p><strong><?php esc_html_e( 'Email', 'complex-patient' ); ?>:</strong> <?php echo esc_html( $user->user_email ); ?></p>
                        <p class="cp-account__help"><?php esc_html_e( 'Use your username and an application password in the mobile app.', 'complex-patient' ); ?></p>
                    </div>
                <?php endif; ?>

                <?php echo AccountUi::privacyCheckbox( ! empty( $values['privacy_policy'] ) ); ?>
                <?php echo AccountUi::fieldError( $fieldErrors, 'privacy_policy' ); ?>

                <?php echo AccountUi::appPasswordCheckbox( true ); ?>

                <button type="submit" class="cp-account__button cp-account__button--primary">
                    <?php esc_html_e( 'Complete setup', 'complex-patient' ); ?>
                </button>
            </form>
        </div>
        <?php
        echo AccountUi::wrapEnd();
        return (string) ob_get_clean();
    }
}
