( function( wp ) {
	const { registerBlockType } = wp.blocks;
	const {
		InspectorControls,
		BlockControls,
		useBlockProps,
		useInnerBlocksProps,
		__experimentalLinkControl: LinkControl,
	} = wp.blockEditor;
	const {
		PanelBody,
		TextControl,
		ToggleControl,
		ToolbarGroup,
		ToolbarButton,
		Popover,
	} = wp.components;
	const { useState, createElement: el, Fragment } = wp.element;
	const { __ } = wp.i18n;

	const ALLOWED_BLOCKS = [ 'font-awesome/icon' ];
	const TEMPLATE = [ [ 'font-awesome/icon' ] ];

	registerBlockType( 'easy-links-fa/linked-icon', {
		edit: function( props ) {
			var attributes = props.attributes;
			var setAttributes = props.setAttributes;

			var blockProps = useBlockProps( {
				className: 'wp-block-easy-links-fa',
			} );

			var innerBlocksProps = useInnerBlocksProps(
				{ className: 'easy-links-fa__inner' },
				{
					allowedBlocks: ALLOWED_BLOCKS,
					template: TEMPLATE,
					templateLock: 'insert',
					renderAppender: false,
				}
			);

			var _useState = useState( false );
			var isLinkOpen = _useState[0];
			var setIsLinkOpen = _useState[1];

			var hasLink = attributes.linkUrl && attributes.linkUrl.length > 0;

			return el( Fragment, null,
				// Toolbar
				el( BlockControls, null,
					el( ToolbarGroup, null,
						el( ToolbarButton, {
							icon: 'admin-links',
							title: __( 'Link', 'easy-links-fa' ),
							onClick: function() { setIsLinkOpen( ! isLinkOpen ); },
							isActive: hasLink,
						} )
					)
				),

				// Link Popover
				isLinkOpen && el( Popover, {
					position: 'bottom center',
					onClose: function() { setIsLinkOpen( false ); },
					focusOnMount: 'firstElement',
				},
					el( 'div', { style: { padding: '16px', minWidth: '300px' } },
						el( LinkControl, {
							value: {
								url: attributes.linkUrl,
								opensInNewTab: attributes.linkTarget === '_blank',
								title: attributes.linkTitle,
							},
							settings: [
								{
									id: 'opensInNewTab',
									title: __( 'Open in new tab', 'easy-links-fa' ),
								},
							],
							onChange: function( next ) {
								setAttributes( {
									linkUrl: next.url || '',
									linkTarget: next.opensInNewTab ? '_blank' : '_self',
									linkRel: next.opensInNewTab ? 'noopener noreferrer' : attributes.linkRel,
									linkTitle: next.title || '',
								} );
							},
							onRemove: function() {
								setAttributes( {
									linkUrl: '',
									linkTarget: '_self',
									linkTitle: '',
									linkRel: '',
								} );
								setIsLinkOpen( false );
							},
						} )
					)
				),

				// Inspector sidebar
				el( InspectorControls, null,
					el( PanelBody, { title: __( 'Link Settings', 'easy-links-fa' ), initialOpen: true },
						el( TextControl, {
							label: __( 'URL', 'easy-links-fa' ),
							value: attributes.linkUrl,
							onChange: function( val ) { setAttributes( { linkUrl: val } ); },
							placeholder: 'https://',
						} ),
						el( ToggleControl, {
							label: __( 'Open in new tab', 'easy-links-fa' ),
							checked: attributes.linkTarget === '_blank',
							onChange: function( val ) {
								setAttributes( {
									linkTarget: val ? '_blank' : '_self',
									linkRel: val ? 'noopener noreferrer' : '',
								} );
							},
						} ),
						el( TextControl, {
							label: __( 'Link Rel', 'easy-links-fa' ),
							value: attributes.linkRel,
							onChange: function( val ) { setAttributes( { linkRel: val } ); },
							placeholder: 'noopener noreferrer',
						} ),
						el( TextControl, {
							label: __( 'Link Title', 'easy-links-fa' ),
							value: attributes.linkTitle,
							onChange: function( val ) { setAttributes( { linkTitle: val } ); },
						} ),
						el( TextControl, {
							label: __( 'Aria Label (accessibility)', 'easy-links-fa' ),
							value: attributes.linkAriaLabel,
							onChange: function( val ) { setAttributes( { linkAriaLabel: val } ); },
							help: __( 'Describe the link purpose for screen readers.', 'easy-links-fa' ),
						} )
					)
				),

				// Block content
				el( 'div', blockProps,
					el( 'div', innerBlocksProps )
				)
			);
		},

		save: function( props ) {
			var blockProps = useBlockProps.save( {
				className: 'wp-block-easy-links-fa',
			} );
			var innerBlocksProps = useInnerBlocksProps.save( {
				className: 'easy-links-fa__inner',
			} );

			return el( 'div', blockProps,
				el( 'div', innerBlocksProps )
			);
		},
	} );
} )( window.wp );
