/**
 * WordPress dependencies
 */
import {
	LineHeightControl,
	__experimentalFontFamilyControl as FontFamilyControl,
} from '@wordpress/block-editor';
import { PanelBody, FontSizePicker } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { useEditorFeature } from '../editor/utils';

export function useHasTypographyPanel( { supports } ) {
	return supports.includes( 'fontSize' ) || supports.includes( 'lineHeight' );
}

export default function TypographyPanel( {
	context: { supports, name },
	getStyleProperty,
	setStyleProperty,
} ) {
	const fontSizes = useEditorFeature( 'typography.fontSizes', name );
	const disableCustomFontSizes = ! useEditorFeature(
		'typography.customFontSize',
		name
	);
	const fontFamilies = useEditorFeature( 'typography.fontFamilies', name );

	return (
		<PanelBody title={ __( 'Typography' ) } initialOpen={ true }>
			{ supports.includes( 'fontFamily' ) && (
				<FontFamilyControl
					value={ getStyleProperty( name, 'fontFamily' ) }
					onChange={ ( value ) =>
						setStyleProperty( name, 'fontFamily', value )
					}
				/>
			) }
			{ supports.includes( 'fontSize' ) && (
				<FontSizePicker
					value={ getStyleProperty( name, 'fontSize' ) }
					onChange={ ( value ) =>
						setStyleProperty( name, 'fontSize', value )
					}
					fontSizes={ fontSizes }
					disableCustomFontSizes={ disableCustomFontSizes }
				/>
			) }
			{ supports.includes( 'lineHeight' ) && (
				<LineHeightControl
					fontFamilies={ fontFamilies }
					value={ getStyleProperty( name, 'lineHeight' ) }
					onChange={ ( value ) =>
						setStyleProperty( name, 'lineHeight', value )
					}
				/>
			) }
		</PanelBody>
	);
}
