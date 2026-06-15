<?php
/**
 * Plugin Name: Easy Links for Font Awesome
 * Plugin URI:  https://github.com/Digital-Defiance/the-complex-patient/tree/main/plugins/easy-links-fa
 * Description: A Gutenberg block that wraps a Font Awesome Icon in a link. Place the native Font Awesome Icon block inside and configure the link — all original icon options preserved.
 * Version:     1.0.0
 * Author:      Digital Defiance
 * License:     GPL-2.0-or-later
 * Text Domain: easy-links-fa
 * Requires Plugins: font-awesome
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the block on init.
 */
function easy_links_fa_block_init() {
	register_block_type( __DIR__ . '/build' );
}
add_action( 'init', 'easy_links_fa_block_init' );
