<?php
/**
 * Plugin Name: The Complex Patient
 * Plugin URI:  https://thecomplexpatient.com
 * Description: Zero-knowledge blind sync backend for The Complex Patient encrypted health platform. Stores and serves opaque encrypted vault blobs without access to plaintext PHI.
 * Version:     0.0.2
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

define( 'COMPLEX_PATIENT_VERSION', '0.0.3' );
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
        global $wpdb;

        \ComplexPatient\Activation::ensureSchema();

        $installedDbVersion = get_option( 'complex_patient_db_version', '' );
        if ( $installedDbVersion !== COMPLEX_PATIENT_VERSION ) {
            \ComplexPatient\Activation::repairMissingTables( $wpdb );
            update_option( 'complex_patient_db_version', COMPLEX_PATIENT_VERSION, false );
        }
    },
    5
);

// PHP / reverse-proxy stacks (including WordPress Studio) often omit HTTP_AUTHORIZATION
// from $_SERVER even when the client sends Authorization: Basic. WordPress core reads
// that variable for Application Password auth on REST requests.
add_action(
    'plugins_loaded',
    static function () {
        if ( ! empty( $_SERVER['HTTP_AUTHORIZATION'] ) ) {
            return;
        }
        if ( ! empty( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
            $_SERVER['HTTP_AUTHORIZATION'] = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
            return;
        }
        if ( function_exists( 'apache_request_headers' ) ) {
            $headers = apache_request_headers();
            if ( ! empty( $headers['Authorization'] ) ) {
                $_SERVER['HTTP_AUTHORIZATION'] = (string) $headers['Authorization'];
            }
        }
    },
    0
);

// WordPress disables Application Passwords on plain HTTP unless the site is marked
// "local". Studio sites on http://localhost:8881 need this for app sign-in.
add_filter(
    'wp_is_application_passwords_available',
    static function ( $available ) {
        if ( $available ) {
            return true;
        }

        $host = isset( $_SERVER['HTTP_HOST'] ) ? strtolower( (string) $_SERVER['HTTP_HOST'] ) : '';
        $host = explode( ':', $host )[0];

        return in_array( $host, array( 'localhost', '127.0.0.1' ), true );
    }
);

// Register the blind-sync REST endpoints on rest_api_init (Requirement 6.5).
// The controller wires the wpdb-backed repository to the auth middleware so
// every vault request is authenticated and scoped before any read or write.
add_action(
    'rest_api_init',
    static function () {
        global $wpdb;

        $auth = new \ComplexPatient\Auth\AuthMiddleware();

        $deviceRepository = new \ComplexPatient\DeviceRepository( $wpdb );
        $vaultNotifier    = new \ComplexPatient\Notification\ExpoPushVaultUpdateNotifier( $deviceRepository );

        $kdfController = new \ComplexPatient\Rest\KdfMaterialController(
            new \ComplexPatient\KdfMaterialRepository( $wpdb ),
            $auth
        );
        $kdfController->registerRoutes();

        $deviceController = new \ComplexPatient\Rest\DeviceController(
            $deviceRepository,
            $auth
        );
        $deviceController->registerRoutes();

        $paperBackupController = new \ComplexPatient\Rest\PaperBackupController(
            new \ComplexPatient\PaperBackupRepository( $wpdb ),
            $auth
        );
        $paperBackupController->registerRoutes();

        $vaultController = new \ComplexPatient\Rest\VaultController(
            new \ComplexPatient\VaultRepository( $wpdb ),
            $auth,
            $vaultNotifier
        );
        $vaultController->registerRoutes();

        $schemaController = new \ComplexPatient\Rest\SchemaController();
        $schemaController->registerRoutes();
    }
);
