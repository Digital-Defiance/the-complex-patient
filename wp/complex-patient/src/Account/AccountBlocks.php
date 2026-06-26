<?php

declare(strict_types=1);

namespace ComplexPatient\Account;

/**
 * Registers Gutenberg blocks and shortcodes for account UX.
 */
final class AccountBlocks
{
    public static function register(): void
    {
        add_action( 'init', array( self::class, 'registerEditorScript' ), 5 );
        add_action( 'init', array( self::class, 'registerBlocks' ), 10 );
        add_action( 'wp_enqueue_scripts', array( self::class, 'enqueueStyles' ) );
        add_filter( 'block_categories_all', array( self::class, 'registerBlockCategory' ) );

        add_shortcode( 'complex_patient_register', array( Blocks\RegisterBlock::class, 'render' ) );
        add_shortcode( 'complex_patient_finish_setup', array( Blocks\FinishSetupBlock::class, 'render' ) );
        add_shortcode( 'complex_patient_application_passwords', array( Blocks\ApplicationPasswordsBlock::class, 'render' ) );
    }

    /**
     * @param array<int, array<string, string>> $categories
     * @return array<int, array<string, string>>
     */
    public static function registerBlockCategory( array $categories ): array
    {
        return array_merge(
            $categories,
            array(
                array(
                    'slug'  => 'complex-patient',
                    'title' => __( 'Complex Patient', 'complex-patient' ),
                ),
            )
        );
    }

    public static function registerEditorScript(): void
    {
        wp_register_script(
            'complex-patient-account-block-editor-base',
            COMPLEX_PATIENT_PLUGIN_URL . 'assets/account-block-editor.js',
            array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
            COMPLEX_PATIENT_VERSION,
            true
        );
    }

    public static function registerBlocks(): void
    {
        $blocks = array(
            'register'               => array( Blocks\RegisterBlock::class, 'render' ),
            'finish-setup'           => array( Blocks\FinishSetupBlock::class, 'render' ),
            'application-passwords'  => array( Blocks\ApplicationPasswordsBlock::class, 'render' ),
        );

        foreach ( $blocks as $slug => $renderer ) {
            $dir = COMPLEX_PATIENT_PLUGIN_DIR . 'blocks/' . $slug;
            if ( file_exists( $dir . '/block.json' ) ) {
                register_block_type(
                    $dir,
                    array(
                        'render_callback' => $renderer,
                    )
                );
            } else {
                register_block_type(
                    'complex-patient/' . $slug,
                    array(
                        'render_callback' => $renderer,
                    )
                );
            }
        }
    }

    public static function enqueueStyles(): void
    {
        if ( ! self::shouldEnqueueStyles() ) {
            return;
        }

        wp_enqueue_style(
            'complex-patient-account',
            COMPLEX_PATIENT_PLUGIN_URL . 'assets/account.css',
            array(),
            COMPLEX_PATIENT_VERSION
        );
    }

    private static function shouldEnqueueStyles(): bool
    {
        if ( ! is_singular() ) {
            return false;
        }

        $post = get_post();
        if ( ! $post instanceof \WP_Post ) {
            return false;
        }

        if ( has_shortcode( $post->post_content, 'complex_patient_register' )
            || has_shortcode( $post->post_content, 'complex_patient_finish_setup' )
            || has_shortcode( $post->post_content, 'complex_patient_application_passwords' ) ) {
            return true;
        }

        return function_exists( 'has_block' ) && (
            has_block( 'complex-patient/register', $post )
            || has_block( 'complex-patient/finish-setup', $post )
            || has_block( 'complex-patient/application-passwords', $post )
        );
    }
}
