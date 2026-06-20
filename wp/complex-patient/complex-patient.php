<?php
/**
 * Plugin Name: The Complex Patient
 * Plugin URI:  https://thecomplexpatient.com
 * Description: Zero-knowledge blind sync backend for The Complex Patient encrypted health platform. Stores and serves opaque encrypted vault blobs without access to plaintext PHI.
 * Version:     0.0.1
 * Author:      The Complex Patient
 * Author URI:  https://thecomplexpatient.com
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: complex-patient
 * Requires at least: 6.0
 * Requires PHP: 8.1
 */

// Prevent direct access.
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'COMPLEX_PATIENT_VERSION', '0.0.1' );
define( 'COMPLEX_PATIENT_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'COMPLEX_PATIENT_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Load the Composer autoloader when available, otherwise fall back to a
// minimal PSR-4 autoloader for the plugin's own classes.
$complex_patient_autoloader = COMPLEX_PATIENT_PLUGIN_DIR . 'vendor/autoload.php';
if ( file_exists( $complex_patient_autoloader ) ) {
    require_once $complex_patient_autoloader;
} else {
    spl_autoload_register(
        static function ( $class ) {
            $prefix = 'ComplexPatient\\';
            if ( 0 !== strpos( $class, $prefix ) ) {
                return;
            }
            $relative = substr( $class, strlen( $prefix ) );
            $path     = COMPLEX_PATIENT_PLUGIN_DIR . 'src/' . str_replace( '\\', '/', $relative ) . '.php';
            if ( file_exists( $path ) ) {
                require_once $path;
            }
        }
    );
}

// Register the activation hook that creates the vault storage schema.
require_once COMPLEX_PATIENT_PLUGIN_DIR . 'src/Activation.php';

/**
 * Plugin activation callback (named function — more reliable than a static
 * class callback in some WordPress / Studio environments).
 */
function complex_patient_activate(): void {
    \ComplexPatient\Activation::activate();
}

register_activation_hook( __FILE__, 'complex_patient_activate' );

// Ensure tables exist on every load (covers failed activations and new tables).
add_action(
    'plugins_loaded',
    static function () {
        \ComplexPatient\Activation::ensureSchema();
    },
    5
);

// Register the blind-sync REST endpoints on rest_api_init (Requirement 6.5).
// The controller wires the wpdb-backed repository to the auth middleware so
// every vault request is authenticated and scoped before any read or write.
add_action(
    'rest_api_init',
    static function () {
        global $wpdb;

        $auth = new \ComplexPatient\Auth\AuthMiddleware();

        $vaultController = new \ComplexPatient\Rest\VaultController(
            new \ComplexPatient\VaultRepository( $wpdb ),
            $auth
        );
        $vaultController->registerRoutes();

        $kdfController = new \ComplexPatient\Rest\KdfMaterialController(
            new \ComplexPatient\KdfMaterialRepository( $wpdb ),
            $auth
        );
        $kdfController->registerRoutes();
    }
);
