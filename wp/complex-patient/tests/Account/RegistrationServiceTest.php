<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Account;

use ComplexPatient\Account\RegistrationService;
use PHPUnit\Framework\TestCase;
use WP_Error;

final class RegistrationServiceTest extends TestCase
{
    protected function tearDown(): void
    {
        unset( $GLOBALS['complex_patient_taken_usernames'], $GLOBALS['complex_patient_taken_emails'] );
        parent::tearDown();
    }

    public function testValidateRegistrationInputSuccess(): void
    {
        $result = RegistrationService::validateRegistrationInput(
            array(
                'display_name'   => 'Jess',
                'username'       => 'jess',
                'email'          => 'jess@example.com',
                'password'       => 'secret',
                'privacy_policy' => '1',
            )
        );

        $this->assertIsArray( $result );
        $this->assertSame( 'jess', $result['username'] );
    }

    public function testValidateRegistrationInputReturnsFieldErrors(): void
    {
        $GLOBALS['complex_patient_taken_usernames'] = array( 'taken' );

        $result = RegistrationService::validateRegistrationInput(
            array(
                'display_name' => '',
                'username'     => 'taken',
                'email'        => 'bad',
                'password'     => '',
            )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'validation_failed', $result->get_error_code() );
        $fields = $result->get_error_data()['fields'];
        $this->assertArrayHasKey( 'username', $fields );
        $this->assertArrayHasKey( 'privacy_policy', $fields );
    }

    public function testValidateFinishSetupInputRequiresPrivacy(): void
    {
        $result = RegistrationService::validateFinishSetupInput(
            array(
                'display_name' => 'Jess',
            )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $fields = $result->get_error_data()['fields'];
        $this->assertArrayHasKey( 'privacy_policy', $fields );
    }
}
