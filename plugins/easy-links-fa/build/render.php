<?php
/**
 * Server-side render callback for Easy Links for Font Awesome block.
 *
 * Variables $attributes, $content, and $block are provided by WordPress
 * block rendering and are local to this file scope when used via "render"
 * in block.json (WordPress 6.1+).
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Inner block content (the Font Awesome Icon block output).
 * @var WP_Block $block      Block instance.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Variables are scoped by WordPress block render file inclusion.

$elfa_url    = isset( $attributes['linkUrl'] ) ? esc_url( $attributes['linkUrl'] ) : '';
$elfa_target = isset( $attributes['linkTarget'] ) ? esc_attr( $attributes['linkTarget'] ) : '_self';
$elfa_rel    = isset( $attributes['linkRel'] ) ? esc_attr( $attributes['linkRel'] ) : '';
$elfa_title  = isset( $attributes['linkTitle'] ) ? esc_attr( $attributes['linkTitle'] ) : '';
$elfa_aria   = isset( $attributes['linkAriaLabel'] ) ? esc_attr( $attributes['linkAriaLabel'] ) : '';

// If no inner content (no icon), render nothing.
if ( empty( trim( $content ) ) ) {
	return;
}

// Build link attributes.
$elfa_link_parts = array();

if ( $elfa_url ) {
	$elfa_link_parts[] = 'href="' . esc_url( $attributes['linkUrl'] ) . '"';
} else {
	$elfa_link_parts[] = 'href="#"';
}

if ( $elfa_target && '_self' !== $elfa_target ) {
	$elfa_link_parts[] = 'target="' . esc_attr( $elfa_target ) . '"';
}

if ( $elfa_rel ) {
	$elfa_link_parts[] = 'rel="' . esc_attr( $elfa_rel ) . '"';
} elseif ( '_blank' === $elfa_target ) {
	$elfa_link_parts[] = 'rel="noopener noreferrer"';
}

if ( $elfa_title ) {
	$elfa_link_parts[] = 'title="' . esc_attr( $elfa_title ) . '"';
}

if ( $elfa_aria ) {
	$elfa_link_parts[] = 'aria-label="' . esc_attr( $elfa_aria ) . '"';
}

$elfa_link_attrs = implode( ' ', $elfa_link_parts );

// phpcs:enable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound

?>
<div <?php echo get_block_wrapper_attributes( array( 'class' => 'wp-block-easy-links-fa' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Returns pre-escaped output. ?>>
	<a class="easy-links-fa__link" <?php echo $elfa_link_attrs; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Each part is individually escaped above. ?>>
		<?php echo wp_kses_post( $content ); ?>
	</a>
</div>
