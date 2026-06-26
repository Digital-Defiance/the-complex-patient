<?php
/**
 * PHPUnit bootstrap file for The Complex Patient plugin tests.
 *
 * Loads the Composer autoloader and any test utilities.
 */

// Load Composer autoloader.
$autoloader = dirname( __DIR__ ) . '/vendor/autoload.php';
if ( file_exists( $autoloader ) ) {
    require_once $autoloader;
}

// Define WordPress stubs for unit testing without a full WP environment.
if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', '/tmp/wordpress/' );
}

// WordPress output-shape constant for wpdb::get_row()/get_results().
if ( ! defined( 'ARRAY_A' ) ) {
    define( 'ARRAY_A', 'ARRAY_A' );
}

// Minimal stub of the global WordPress database class so plugin classes that
// type-hint \wpdb can be exercised without a live WordPress install.
if ( ! class_exists( 'wpdb' ) ) {
    class wpdb
    {
        public string $prefix = 'wp_';
        public string $last_error = '';

        public function get_charset_collate(): string
        {
            return '';
        }

        public function prepare( string $query, ...$args ): string
        {
            // Naive sprintf-style stand-in adequate for unit tests.
            $query = str_replace( array( '%s', '%d' ), array( "'%s'", '%d' ), $query );

            return vsprintf( $query, $args );
        }

        public function get_var( string $query )
        {
            return null;
        }

        public function query( string $query )
        {
            return 0;
        }
    }
}

// Stub WordPress helper functions used during activation.
if ( ! function_exists( 'dbDelta' ) ) {
    function dbDelta( $queries )
    {
        global $wpdb;
        if ( is_object( $wpdb ) && method_exists( $wpdb, 'recordDbDelta' ) ) {
            $wpdb->recordDbDelta( is_array( $queries ) ? implode( "\n", $queries ) : (string) $queries );
        }

        return array();
    }
}

if ( ! function_exists( 'esc_html' ) ) {
    function esc_html( $text )
    {
        return $text;
    }
}

// Stub WordPress plugin-path helpers used by the plugin bootstrap file.
if ( ! function_exists( 'plugin_dir_path' ) ) {
    function plugin_dir_path( $file )
    {
        return rtrim( dirname( $file ), '/' ) . '/';
    }
}

if ( ! function_exists( 'plugin_dir_url' ) ) {
    function plugin_dir_url( $file )
    {
        return 'http://example.test/wp-content/plugins/' . basename( dirname( $file ) ) . '/';
    }
}

if ( ! function_exists( 'register_activation_hook' ) ) {
    function register_activation_hook( $file, $callback )
    {
        // No-op in the unit-test environment.
    }
}

// --- Authentication / authorization stubs (Requirement 4) ---

// Controllable current-user id for AuthMiddleware tests. Tests set
// $GLOBALS['complex_patient_current_user_id'] to simulate a logged-in user.
if ( ! function_exists( 'get_current_user_id' ) ) {
    function get_current_user_id()
    {
        return (int) ( $GLOBALS['complex_patient_current_user_id'] ?? 0 );
    }
}

// Controllable rest_authentication_errors result. Tests set
// $GLOBALS['complex_patient_auth_filter_result'] to a WP_Error to simulate
// invalid/expired credentials, true for success, or null (default) for "no
// credentials evaluated".
if ( ! function_exists( 'apply_filters' ) ) {
    function apply_filters( $hook, $value, ...$args )
    {
        if ( 'rest_authentication_errors' === $hook
            && array_key_exists( 'complex_patient_auth_filter_result', $GLOBALS )
        ) {
            return $GLOBALS['complex_patient_auth_filter_result'];
        }

        return $value;
    }
}

if ( ! class_exists( 'WP_Error' ) ) {
    class WP_Error
    {
        /** @var array<string,array<int,string>> */
        public array $errors = array();

        /** @var array<string,mixed> */
        public array $error_data = array();

        private string $first_code = '';

        public function __construct( $code = '', $message = '', $data = '' )
        {
            if ( '' !== $code ) {
                $this->first_code            = (string) $code;
                $this->errors[ $code ][]     = (string) $message;
                if ( '' !== $data ) {
                    $this->error_data[ $code ] = $data;
                }
            }
        }

        public function get_error_code()
        {
            return $this->first_code;
        }

        public function get_error_message()
        {
            if ( '' === $this->first_code ) {
                return '';
            }

            return $this->errors[ $this->first_code ][0] ?? '';
        }

        public function get_error_data( $code = '' )
        {
            $code = '' === $code ? $this->first_code : $code;

            return $this->error_data[ $code ] ?? null;
        }
    }
}

if ( ! function_exists( 'is_wp_error' ) ) {
    function is_wp_error( $thing )
    {
        return $thing instanceof WP_Error;
    }
}

// Minimal stand-in for WP_REST_Request adequate for unit tests. Exposes the
// get_param accessor the middleware relies on.
if ( ! class_exists( 'WP_REST_Request' ) ) {
    class WP_REST_Request
    {
        /** @var array<string,mixed> */
        private array $params;

        /** @var array<string,string> */
        private array $headers = [];

        /**
         * @param array<string,mixed> $params
         */
        public function __construct( array $params = array() )
        {
            $this->params = $params;
        }

        public function get_param( string $key )
        {
            return $this->params[ $key ] ?? null;
        }

        public function set_param( string $key, $value ): void
        {
            $this->params[ $key ] = $value;
        }

        public function get_header( string $key )
        {
            $normalized = strtolower( str_replace( '_', '-', $key ) );

            return $this->headers[ $normalized ] ?? null;
        }

        public function set_header( string $key, string $value ): void
        {
            $normalized = strtolower( str_replace( '_', '-', $key ) );
            $this->headers[ $normalized ] = $value;
        }
    }
}

// Minimal stand-in for WP_REST_Response. Carries a data payload and an HTTP
// status code, mirroring the subset of the real class the controller uses.
if ( ! class_exists( 'WP_REST_Response' ) ) {
    class WP_REST_Response
    {
        /** @var mixed */
        private $data;

        private int $status;

        public function __construct( $data = null, int $status = 200 )
        {
            $this->data   = $data;
            $this->status = $status;
        }

        public function get_data()
        {
            return $this->data;
        }

        public function get_status(): int
        {
            return $this->status;
        }

        public function set_status( int $status ): void
        {
            $this->status = $status;
        }
    }
}

// Records REST route registrations so tests can assert the controller wired up
// the expected endpoints on rest_api_init.
if ( ! function_exists( 'register_rest_route' ) ) {
    function register_rest_route( $namespace, $route, $args = array(), $override = false )
    {
        if ( ! isset( $GLOBALS['complex_patient_registered_routes'] ) ) {
            $GLOBALS['complex_patient_registered_routes'] = array();
        }

        $GLOBALS['complex_patient_registered_routes'][] = array(
            'namespace' => $namespace,
            'route'     => $route,
            'args'      => $args,
            'override'  => $override,
        );

        return true;
    }
}

// Stub of add_filter / add_action used by plugin bootstrap hooks.
if ( ! function_exists( 'add_filter' ) ) {
    function add_filter( $hook, $callback, $priority = 10, $accepted_args = 1 )
    {
        return true;
    }
}

// Stub of add_action used to bind the controller to rest_api_init.
if ( ! function_exists( 'add_action' ) ) {
    function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 )
    {
        if ( ! isset( $GLOBALS['complex_patient_actions'] ) ) {
            $GLOBALS['complex_patient_actions'] = array();
        }

        $GLOBALS['complex_patient_actions'][ $hook ][] = $callback;

        return true;
    }
}

if ( ! function_exists( 'add_shortcode' ) ) {
    function add_shortcode( $tag, $callback )
    {
        return true;
    }
}

// Deterministic-ish server time helper. Tests can pin the result by setting
// $GLOBALS['complex_patient_current_time']; otherwise a real UTC MySQL
// timestamp is produced.
if ( ! function_exists( 'current_time' ) ) {
    function current_time( $type, $gmt = 0 )
    {
        if ( isset( $GLOBALS['complex_patient_current_time'] ) ) {
            return $GLOBALS['complex_patient_current_time'];
        }

        return gmdate( 'Y-m-d H:i:s' );
    }
}

if ( ! function_exists( 'wp_json_encode' ) ) {
    function wp_json_encode( $data, $options = 0, $depth = 512 )
    {
        return json_encode( $data, $options, $depth );
    }
}

if ( ! function_exists( 'get_option' ) ) {
    function get_option( $option, $default = false )
    {
        if ( $option === 'users_can_register' ) {
            return $GLOBALS['complex_patient_users_can_register'] ?? true;
        }

        return $default;
    }
}

if ( ! function_exists( 'sanitize_text_field' ) ) {
    function sanitize_text_field( $str )
    {
        return trim( (string) $str );
    }
}

if ( ! function_exists( 'sanitize_user' ) ) {
    function sanitize_user( $username, $strict = false )
    {
        return strtolower( (string) $username );
    }
}

if ( ! function_exists( 'sanitize_email' ) ) {
    function sanitize_email( $email )
    {
        return (string) $email;
    }
}

if ( ! function_exists( 'is_email' ) ) {
    function is_email( $email )
    {
        return str_contains( (string) $email, '@' );
    }
}

if ( ! function_exists( 'username_exists' ) ) {
    function username_exists( $username )
    {
        return in_array( (string) $username, $GLOBALS['complex_patient_taken_usernames'] ?? array(), true );
    }
}

if ( ! function_exists( 'email_exists' ) ) {
    function email_exists( $email )
    {
        return in_array( (string) $email, $GLOBALS['complex_patient_taken_emails'] ?? array(), true );
    }
}

if ( ! function_exists( '__' ) ) {
    function __( $text, $domain = null )
    {
        return $text;
    }
}
