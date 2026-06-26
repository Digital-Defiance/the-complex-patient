( function ( blocks, element, blockEditor, components, i18n ) {
	var el = element.createElement;
	var useBlockProps = blockEditor.useBlockProps;
	var Placeholder = components.Placeholder;
	var __ = i18n.__;

	window.cpAccountBlockEditor = {
		register: function ( name, title, icon, hint ) {
			var edit = function () {
				var blockProps = useBlockProps( { className: 'cp-account-block-placeholder' } );
				return el(
					'div',
					blockProps,
					el(
						Placeholder,
						{
							icon: icon,
							label: title,
							instructions: hint,
						},
						__( 'Preview appears on the published page.', 'complex-patient' )
					)
				);
			};

			var existing = blocks.getBlockType( name );
			if ( existing ) {
				blocks.registerBlockType( name, Object.assign( {}, existing, {
					edit: edit,
					save: function () {
						return null;
					},
				} ) );
				return;
			}

			blocks.registerBlockType( name, {
				apiVersion: 3,
				title: title,
				category: 'complex-patient',
				icon: icon,
				description: hint,
				supports: { html: false },
				edit: edit,
				save: function () {
					return null;
				},
			} );
		},
	};
} )(
	window.wp.blocks,
	window.wp.element,
	window.wp.blockEditor,
	window.wp.components,
	window.wp.i18n
);
