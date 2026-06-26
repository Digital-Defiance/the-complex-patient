<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

use WP_Error;

/**
 * Email/password registration for the join form.
 */
final class RegistrationService
{
    public const ACTION_REGISTER = 'complex_patient_register';
    public const ACTION_FINISH   = 'complex_patient_finish_setup';
    public const ACTION_APP_PW   = 'complex_patient_application_password';

    public const DEFAULT_APP_PASSWORD_NAME = 'Mobile app';

    /**
     * @param array<string, mixed> $input
     * @return array<string, string>|WP_Error
     */
    public static function validateRegistrationInput( array $input )
    {
        $errors = array();

        $displayName = sanitize_text_field( (string) ( $input['display_name'] ?? '' ) );
        $username    = sanitize_user( (string) ( $input['username'] ?? '' ), true );
        $email       = sanitize_email( (string) ( $input['email'] ?? '' ) );
        $password    = (string) ( $input['password'] ?? '' );
        $privacy     = ! empty( $input['privacy_policy'] );

        if ( $displayName === '' ) {
            $errors['display_name'] = __( 'Please enter the name you want to show in groups.', 'complex-patient' );
        }

        if ( $username === '' ) {
            $errors['username'] = __( 'Please choose a username.', 'complex-patient' );
        } elseif ( username_exists( $username ) ) {
            $errors['username'] = __( 'That username is already taken.', 'complex-patient' );
        }

        if ( $email === '' || ! is_email( $email ) ) {
            $errors['email'] = __( 'Please enter a valid email address.', 'complex-patient' );
        } elseif ( email_exists( $email ) ) {
            $errors['email'] = __( 'That email address is already registered.', 'complex-patient' );
        }

        if ( $password === '' ) {
            $errors['password'] = __( 'Please choose a password.', 'complex-patient' );
        }

        if ( ! $privacy ) {
            $errors['privacy_policy'] = __( 'You must agree to the privacy policy.', 'complex-patient' );
        }

        if ( ! get_option( 'users_can_register' ) ) {
            return new WP_Error(
                'registration_disabled',
                __( 'Registration is disabled on this site.', 'complex-patient' )
            );
        }

        if ( $errors !== array() ) {
            return new WP_Error( 'validation_failed', '', array( 'fields' => $errors ) );
        }

        return array(
            'display_name' => $displayName,
            'username'     => $username,
            'email'        => $email,
            'password'     => $password,
        );
    }

    /**
     * @return array{user_id: int, app_password: ?string, app_password_name: string}|WP_Error
     */
    public static function registerWithEmail( array $validated, bool $createAppPassword )
    {
        $userId = wp_create_user(
            $validated['username'],
            $validated['password'],
            $validated['email']
        );

        if ( is_wp_error( $userId ) ) {
            return $userId;
        }

        BuddyPressRegistration::syncDisplayName( (int) $userId, $validated['display_name'] );
        AccountSetup::markComplete( (int) $userId );

        $appPassword     = null;
        $appPasswordName = self::DEFAULT_APP_PASSWORD_NAME;

        if ( $createAppPassword && ApplicationPasswordService::isAvailable() ) {
            $created = ApplicationPasswordService::createForUser( (int) $userId, $appPasswordName );
            if ( ! is_wp_error( $created ) ) {
                $appPassword = $created['password'];
                AccountSetup::storeNewApplicationPasswordFlash(
                    (int) $userId,
                    $created['password'],
                    $created['name']
                );
            }
        }

        wp_set_current_user( (int) $userId );
        wp_set_auth_cookie( (int) $userId );

        return array(
            'user_id'           => (int) $userId,
            'app_password'      => $appPassword,
            'app_password_name' => $appPasswordName,
        );
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, string>|WP_Error
     */
    public static function validateFinishSetupInput( array $input )
    {
        $errors = array();

        $displayName = sanitize_text_field( (string) ( $input['display_name'] ?? '' ) );
        $privacy     = ! empty( $input['privacy_policy'] );

        if ( $displayName === '' ) {
            $errors['display_name'] = __( 'Please enter the name you want to show in groups.', 'complex-patient' );
        }

        if ( ! $privacy ) {
            $errors['privacy_policy'] = __( 'You must agree to the privacy policy.', 'complex-patient' );
        }

        if ( $errors !== array() ) {
            return new WP_Error( 'validation_failed', '', array( 'fields' => $errors ) );
        }

        return array(
            'display_name' => $displayName,
        );
    }

    /**
     * @return array{app_password: ?string, app_password_name: string}|WP_Error
     */
    public static function completeFinishSetup( int $userId, array $validated, bool $createAppPassword )
    {
        BuddyPressRegistration::syncDisplayName( $userId, $validated['display_name'] );
        AccountSetup::markComplete( $userId );

        $appPassword     = null;
        $appPasswordName = self::DEFAULT_APP_PASSWORD_NAME;

        if ( $createAppPassword && ApplicationPasswordService::isAvailable() ) {
            $created = ApplicationPasswordService::createForUser( $userId, $appPasswordName );
            if ( ! is_wp_error( $created ) ) {
                $appPassword = $created['password'];
                AccountSetup::storeNewApplicationPasswordFlash(
                    $userId,
                    $created['password'],
                    $created['name']
                );
            }
        }

        return array(
            'app_password'      => $appPassword,
            'app_password_name' => $appPasswordName,
        );
    }

    public static function verifyNonce( string $action, string $nonceField = '_cp_nonce' ): bool
    {
        if ( ! isset( $_POST[ $nonceField ] ) ) {
            return false;
        }

        return (bool) wp_verify_nonce(
            sanitize_text_field( wp_unslash( (string) $_POST[ $nonceField ] ) ),
            $action
        );
    }
}
