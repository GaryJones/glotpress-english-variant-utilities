import { readFileSync } from 'node:fs';

export const SET_URL = 'https://translate.wordpress.org/projects/wp/dev/en-gb/default/';
export const IMPORT_URL = SET_URL + 'import-translations/';

const fixture = ( name ) => readFileSync( new URL( `./fixtures/${ name }`, import.meta.url ), 'utf8' );
export const SET_HTML = fixture( 'set.html' );
export const IMPORT_HTML = fixture( 'import.html' );

// Exactly what GlotPress sends when an identical translation already exists.
export const IDENTICAL = 'Identical current or waiting translation already exists.';

/**
 * Load the translation-set fixture on its real URL, then run the userscript
 * on it, as Tampermonkey would.
 *
 * Every request to translate.wordpress.org goes to `handle( route, request )`
 * first; it returns true once it has fulfilled the route. Otherwise GETs get
 * the fixtures, and anything else fails the test, so nothing reaches the
 * real site.
 */
export async function openSet( page, { handle = () => {}, html = SET_HTML } = {} ) {
	await page.route( '**/*', async ( route, request ) => {
		if ( await handle( route, request ) ) {
			return;
		}
		const url = request.url().split( '?' )[ 0 ];
		if ( 'GET' === request.method() && SET_URL === url ) {
			return route.fulfill( { contentType: 'text/html', body: html } );
		}
		if ( 'GET' === request.method() && IMPORT_URL === url ) {
			return route.fulfill( { contentType: 'text/html', body: IMPORT_HTML } );
		}
		throw new Error( 'Unexpected request: ' + request.method() + ' ' + request.url() );
	} );
	await page.goto( SET_URL );

	// Playwright can't mock the request a redirect leads to, so mocked
	// responses name their "redirect" target in a header instead, and this
	// sets response.url from it, as following the redirect would.
	await page.evaluate( () => {
		const realFetch = window.fetch;
		window.fetch = async ( ...args ) => {
			const response = await realFetch( ...args );
			const target = response.headers.get( 'x-test-redirected-to' );
			if ( target ) {
				Object.defineProperty( response, 'url', { value: target } );
			}
			return response;
		};
	} );
	await page.addScriptTag( { path: new URL( '../glotpress-en_gb.user.js', import.meta.url ).pathname } );
}

export const row = ( page, label ) => page.locator( `tr.preview[data-fixture="${ label }"]` );

export const rowId = ( page, label ) => row( page, label ).getAttribute( 'row' );

export const tick = ( page, label ) => row( page, label ).locator( 'input[name="selected-row[]"]' ).check();

export const status = ( page ) => page.locator( '.gp-en-gb-status' );

// The save response: a JSON map of original id to the new rows' HTML.
export async function savedRowsJson( page, label ) {
	return page.evaluate( ( label ) => {
		const preview = document.querySelector( `tr.preview[data-fixture="${ label }"]` );
		const id = preview.getAttribute( 'row' );
		const originalId = id.split( '-' )[ 0 ];
		const newId = originalId + '-999';
		const raws = [ ...document.getElementById( 'editor-' + id ).querySelectorAll( '.original-raw' ) ].map( ( el ) => el.textContent );
		const swap = ( html ) => html
			.replace( new RegExp( `(preview-|editor-|row=")${ id }\\b`, 'g' ), `$1${ newId }` ).replace( /(class="(?:preview|editor)) untranslated/g, '$1 status-current' );
		const newPreview = swap( preview.outerHTML ).replace(
			/<span class="missing">[^<]*<\/span>/,
			'<span class="translation-text">' + raws[ 0 ] + '</span>'
		);
		return JSON.stringify( { [ originalId ]: newPreview + swap( document.getElementById( 'editor-' + id ).outerHTML ) } );
	}, label );
}
