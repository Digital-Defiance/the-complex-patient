<?php

declare(strict_types=1);

namespace ComplexPatient\Tests;

use PHPUnit\Framework\TestCase;

/**
 * Verifies the plugin bootstrap file is loadable.
 */
final class PluginBootstrapTest extends TestCase
{
    public function testPluginConstantsAreDefined(): void
    {
        // Load the plugin bootstrap (constants will be defined).
        require_once dirname(__DIR__) . '/complex-patient.php';

        $this->assertSame('0.0.4', COMPLEX_PATIENT_VERSION);
        $this->assertTrue(defined('COMPLEX_PATIENT_PLUGIN_DIR'));
        $this->assertTrue(defined('COMPLEX_PATIENT_PLUGIN_URL'));
        $this->assertTrue(function_exists('complex_patient_activate'));
    }
}
