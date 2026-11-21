import { test, expect } from '@playwright/test';
import { openSet, row } from './helpers.js';

const GREEN = 'rgb(0, 128, 0)';
const RED = 'rgb(255, 0, 0)';
const translation = ( page, label ) => row( page, label ).locator( 'td.translation' );

test.beforeEach( async ( { page } ) => {
	await openSet( page );
} );

test( 'a translation identical to the original is green', async ( { page } ) => {
	await expect( translation( page, 'context and priority' ) ).toHaveCSS( 'color', GREEN );
	await expect( translation( page, 'context and priority' ) ).toHaveAttribute( 'title', 'Same as original' );
} );

test( 'a translation that differs from the original is red', async ( { page } ) => {
	await expect( translation( page, 'differs (US to UK spelling)' ) ).toHaveCSS( 'color', RED );
	await expect( translation( page, 'differs (US to UK spelling)' ) ).toHaveAttribute( 'title', 'Differs from original' );
} );

test( 'untranslated rows are left alone', async ( { page } ) => {
	for ( const label of [ 'untranslated singular', 'untranslated plural', 'untranslated with context' ] ) {
		await expect( translation( page, label ) ).not.toHaveAttribute( 'title', /original/ );
	}
} );

// Regression: literal arrows were stripped from the original only.
test( 'a literal arrow in the string is kept when comparing', async ( { page } ) => {
	await expect( translation( page, 'arrow, identical' ) ).toHaveCSS( 'color', GREEN );
} );

// Regression: boxed leading/trailing spaces were dropped from the original only.
test( 'a trailing space in the string is kept when comparing', async ( { page } ) => {
	await expect( translation( page, 'trailing space' ) ).toHaveCSS( 'color', GREEN );
} );

test( 'newline glyphs in the original are ignored', async ( { page } ) => {
	await expect( translation( page, 'newline glyphs' ) ).toHaveCSS( 'color', GREEN );
} );

test( 'singular and plural are compared together', async ( { page } ) => {
	await expect( translation( page, 'translated plural' ) ).toHaveCSS( 'color', GREEN );
} );

test( 'the hidden chrome is shown again after measuring', async ( { page } ) => {
	const original = row( page, 'newline glyphs' ).locator( 'td.original' );
	await expect( original.locator( '.invisibles' ).first() ).toBeVisible();
	await expect( row( page, 'context and priority' ).locator( '.original-tags' ) ).toBeVisible();
} );

test( 'a row GlotPress replaces is coloured again', async ( { page } ) => {
	await page.evaluate( () => {
		const old = document.querySelector( 'tr.preview[data-fixture="trailing space"]' );
		const replacement = old.cloneNode( true );
		replacement.querySelector( 'td.translation' ).removeAttribute( 'style' );
		replacement.querySelector( '.translation-text' ).textContent = 'Could not run: ';
		old.replaceWith( replacement );
	} );

	await expect( translation( page, 'trailing space' ) ).toHaveCSS( 'color', RED );
} );

// Regression: innerText ignores CSS on a row that isn't rendered, so a row
// hidden while its editor was open was measured with its glyphs and shown red.
test( 'a row whose editor is open is coloured correctly', async ( { page } ) => {
	await page.evaluate( () => {
		const old = document.querySelector( 'tr.preview[data-fixture="newline glyphs"]' );
		const replacement = old.cloneNode( true );
		replacement.querySelector( 'td.translation' ).removeAttribute( 'style' );
		replacement.querySelector( 'td.translation' ).removeAttribute( 'title' );
		replacement.style.display = 'none';
		old.replaceWith( replacement );
	} );
	await expect( translation( page, 'newline glyphs' ) ).toHaveAttribute( 'title', /original/ );
	await expect( row( page, 'newline glyphs' ) ).toBeHidden();
	await row( page, 'newline glyphs' ).evaluate( ( tr ) => {
		tr.style.display = '';
	} );

	await expect( translation( page, 'newline glyphs' ) ).toHaveCSS( 'color', GREEN, { timeout: 1000 } );
} );
