<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

/**
 * Redirect legacy BuddyPress registration and handle form POST actions.
 */
final class AccountRedirects
{
    public static function register(): void
    {
        add_action( 'template_redirect', array( self::class, 'redirectLegacyRegister' ), 5 );
        add_action( 'template_redirect', array( self::class, 'handlePostActions' ), 6 );
    }

    public static function joinUrl(): string
    {
        return JetpackSsoIntegration::joinUrl();
    }

    public static function applicationPasswordsUrl(): string
    {
        $pageId = (int) get_option( 'complex_patient_app_passwords_page_id', 0 );
        if ( $pageId > 0 ) {
            $url = get_permalink( $pageId );
            if ( is_string( $url ) && $url !== '' ) {
                return $url;
            }
        }

        return home_url( '/account/application-passwords/' );
    }

    public static function redirectLegacyRegister(): void
    {
        if ( ! function_exists( 'bp_is_register_page' ) || ! bp_is_register_page() ) {
            return;
        }

        wp_safe_redirect( self::joinUrl() );
        exit;
    }

    public static function handlePostActions(): void
    {
        if ( $_SERVER['REQUEST_METHOD'] !== 'POST' || empty( $_POST['complex_patient_action'] ) ) {
            return;
        }

        $action = sanitize_text_field( wp_unslash( (string) $_POST['complex_patient_action'] ) );

        switch ( $action ) {
            case RegistrationService::ACTION_REGISTER:
                self::handleRegisterPost();
                break;
            case RegistrationService::ACTION_FINISH:
                self::handleFinishSetupPost();
                break;
            case RegistrationService::ACTION_APP_PW . '_create':
                self::handleAppPasswordCreate();
                break;
            case RegistrationService::ACTION_APP_PW . '_revoke':
                self::handleAppPasswordRevoke();
                break;
        }
    }

    private static function handleRegisterPost(): void
    {
        if ( ! RegistrationService::verifyNonce( RegistrationService::ACTION_REGISTER ) ) {
            return;
        }

        $validated = RegistrationService::validateRegistrationInput( wp_unslash( $_POST ) );
        if ( is_wp_error( $validated ) ) {
            if ( $validated->get_error_code() === 'validation_failed' ) {
                $data   = $validated->get_error_data();
                $fields = is_array( $data ) && isset( $data['fields'] ) && is_array( $data['fields'] )
                    ? $data['fields']
                    : array();
                self::flashFormState( 'register', '', wp_unslash( $_POST ), $fields );
            } else {
                self::flashFormState( 'register', $validated->get_error_message(), wp_unslash( $_POST ) );
            }
            return;
        }

        $createAppPassword = ! empty( $_POST['create_app_password'] );
        $result            = RegistrationService::registerWithEmail( $validated, $createAppPassword );

        if ( is_wp_error( $result ) ) {
            self::flashFormState( 'register', $result->get_error_message(), wp_unslash( $_POST ) );
            return;
        }

        self::flashSuccess( 'register', $result );
        wp_safe_redirect( add_query_arg( 'registered', '1', self::joinUrl() ) );
        exit;
    }

    private static function handleFinishSetupPost(): void
    {
        if ( ! is_user_logged_in() ) {
            return;
        }

        if ( ! RegistrationService::verifyNonce( RegistrationService::ACTION_FINISH ) ) {
            return;
        }

        $userId    = get_current_user_id();
        $validated = RegistrationService::validateFinishSetupInput( wp_unslash( $_POST ) );

        if ( is_wp_error( $validated ) ) {
            if ( $validated->get_error_code() === 'validation_failed' ) {
                $data   = $validated->get_error_data();
                $fields = is_array( $data ) && isset( $data['fields'] ) && is_array( $data['fields'] )
                    ? $data['fields']
                    : array();
                self::flashFormState( 'finish', '', wp_unslash( $_POST ), $fields );
            } else {
                self::flashFormState( 'finish', $validated->get_error_message(), wp_unslash( $_POST ) );
            }
            return;
        }

        $createAppPassword = ! empty( $_POST['create_app_password'] );
        $result            = RegistrationService::completeFinishSetup( $userId, $validated, $createAppPassword );

        if ( is_wp_error( $result ) ) {
            self::flashFormState( 'finish', $result->get_error_message(), wp_unslash( $_POST ) );
            return;
        }

        self::flashSuccess( 'finish', $result );
        wp_safe_redirect( add_query_arg( 'setup', '1', JetpackSsoIntegration::finishSetupUrl() ) );
        exit;
    }

    private static function handleAppPasswordCreate(): void
    {
        if ( ! is_user_logged_in() ) {
            return;
        }

        if ( ! RegistrationService::verifyNonce( RegistrationService::ACTION_APP_PW . '_create' ) ) {
            return;
        }

        $userId = get_current_user_id();
        $name   = sanitize_text_field( wp_unslash( (string) ( $_POST['app_password_name'] ?? '' ) ) );
        $result = ApplicationPasswordService::createForUser( $userId, $name );

        if ( is_wp_error( $result ) ) {
            self::flashFormState( 'app_passwords', $result->get_error_message(), wp_unslash( $_POST ) );
            return;
        }

        AccountSetup::storeNewApplicationPasswordFlash( $userId, $result['password'], $result['name'] );
        wp_safe_redirect( add_query_arg( 'created', '1', self::applicationPasswordsUrl() ) );
        exit;
    }

    private static function handleAppPasswordRevoke(): void
    {
        if ( ! is_user_logged_in() ) {
            return;
        }

        if ( ! RegistrationService::verifyNonce( RegistrationService::ACTION_APP_PW . '_revoke' ) ) {
            return;
        }

        $userId = get_current_user_id();
        $uuid   = sanitize_text_field( wp_unslash( (string) ( $_POST['app_password_uuid'] ?? '' ) ) );
        $result = ApplicationPasswordService::revokeForUser( $userId, $uuid );

        if ( is_wp_error( $result ) ) {
            self::flashFormState( 'app_passwords', $result->get_error_message(), array() );
            return;
        }

        wp_safe_redirect( add_query_arg( 'revoked', '1', self::applicationPasswordsUrl() ) );
        exit;
    }

    /**
     * @param array<string, mixed> $values
     * @param array<string, string>|null $fieldErrors
     */
    private static function flashFormState( string $context, string $message, array $values, ?array $fieldErrors = null ): void
    {
        set_transient(
            'complex_patient_form_' . $context . '_' . ( is_user_logged_in() ? (string) get_current_user_id() : 'guest' ),
            array(
                'message'      => $message,
                'values'       => $values,
                'field_errors' => $fieldErrors ?? array(),
            ),
            5 * MINUTE_IN_SECONDS
        );
    }

    /**
     * @param array<string, mixed> $result
     */
    private static function flashSuccess( string $context, array $result ): void
    {
        set_transient(
            'complex_patient_success_' . $context . '_' . ( is_user_logged_in() ? (string) get_current_user_id() : 'guest' ),
            $result,
            5 * MINUTE_IN_SECONDS
        );
    }

    /**
     * @return array{message: string, values: array<string, mixed>, field_errors: array<string, string>}|null
     */
    public static function consumeFormState( string $context ): ?array
    {
        $key  = 'complex_patient_form_' . $context . '_' . ( is_user_logged_in() ? (string) get_current_user_id() : 'guest' );
        $data = get_transient( $key );
        delete_transient( $key );

        return is_array( $data ) ? $data : null;
    }
}
