<?php

declare(strict_types=1);

namespace ComplexPatient\Tests\Account;

use ComplexPatient\Account\ApplicationPasswordService;
use PHPUnit\Framework\TestCase;
use WP_Error;

final class ApplicationPasswordServiceTest extends TestCase
{
    public function testMapCreatedPasswordUsesWordPressReturnShape(): void
    {
        $created = ApplicationPasswordService::mapCreatedPassword(
            array(
                '0Ejn0js0vRRCVgeLj1FPv90A',
                array(
                    'uuid'     => '11111111-2222-3333-4444-555555555555',
                    'name'     => 'TCP',
                    'password' => 'hashed-value',
                ),
            ),
            'TCP'
        );

        $this->assertIsArray( $created );
        $this->assertSame( '0Ejn 0js0 vRRC VgeL j1FP v90A', $created['password'] );
        $this->assertSame( '11111111-2222-3333-4444-555555555555', $created['uuid'] );
        $this->assertSame( 'TCP', $created['name'] );
    }

    public function testFormatForDisplayChunksEveryFourCharacters(): void
    {
        $this->assertSame(
            '0Ejn 0js0 vRRC VgeL j1FP v90A',
            ApplicationPasswordService::formatForDisplay( '0Ejn0js0vRRCVgeLj1FPv90A' )
        );
    }

    public function testMapCreatedPasswordRejectsMalformedResponse(): void
    {
        $created = ApplicationPasswordService::mapCreatedPassword(
            array( 'only-one-value' ),
            'TCP'
        );

        $this->assertInstanceOf( WP_Error::class, $created );
    }
}
