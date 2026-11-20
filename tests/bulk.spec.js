import { test, expect } from '@playwright/test';
import { IDENTICAL, IMPORT_HTML, IMPORT_URL, SET_HTML, SET_URL, openSet, row, rowId, savedRowsJson, status, tick } from './helpers.js';

const AMBER = 'rgb(219, 166, 23)';
const RED = 'rgb(214, 54, 56)';
const GREEN = 'rgb(0, 128, 0)';

const copyButton = ( page ) => page.getByRole( 'button', { name: /Copy original & save/ } );
const isSave = ( request ) => 'POST' === request.method() && SET_URL === request.url();

test.describe( 'toolbar', () => {
	test( 'is not added without bulk permissions', async ( { page } ) => {
		await openSet( page, { html: SET_HTML.replaceAll( '<input type="checkbox" name="selected-row[]">', '' ) } );

		await expect( page.locator( '.gp-en-gb-toolbar' ) ).toHaveCount( 0 );
		await expect( row( page, 'differs (US to UK spelling)' ).locator( 'td.translation' ) ).toHaveAttribute( 'title', 'Differs from original' );
	} );

	test( 'Select untranslated ticks only untranslated rows', async ( { page } ) => {
		await openSet( page );

		await page.getByRole( 'button', { name: 'Select untranslated' } ).click();

		await expect( page.locator( 'tr.preview.untranslated input:checked' ) ).toHaveCount( 3 );
		await expect( page.locator( 'tr.preview:not(.untranslated) input:checked' ) ).toHaveCount( 0 );
		await expect( copyButton( page ) ).toHaveText( 'Copy original & save (3)' );
	} );

	test( 'the count follows rows ticked by hand', async ( { page } ) => {
		await openSet( page );

		await tick( page, 'arrow, identical' );
		await tick( page, 'trailing space' );

		await expect( copyButton( page ) ).toHaveText( 'Copy original & save (2)' );
	} );

	test( 'asks for a selection when nothing is ticked', async ( { page } ) => {
		await openSet( page );

		await copyButton( page ).click();

		await expect( status( page ) ).toHaveText( 'No rows selected.' );
	} );
} );

test.describe( 'row-by-row saves', () => {
	test( 'send the same request as the editor\'s Save button', async ( { page } ) => {
		const saves = [];
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( isSave( request ) ) {
					saves.push( new URLSearchParams( request.postData() ) );
					await route.fulfill( { body: IDENTICAL } );
					return true;
				}
			},
		} );

		await tick( page, 'arrow, identical' );
		await tick( page, 'translated plural' );
		await copyButton( page ).click();
		await expect( status( page ) ).toHaveText( 'Saved 0 · 2 already existed.' );

		const byId = Object.fromEntries( saves.map( ( params ) => [ params.get( 'original_id' ), params ] ) );
		// Row ids are "<originalId>-<translationId>"; only the original id is sent.
		expect( Object.keys( byId ).sort() ).toEqual( [ '22999570', '32887665' ] );
		expect( byId[ '22999570' ].get( '_gp_route_nonce' ) ).toBe( 'test-nonce-22999570' );
		expect( byId[ '22999570' ].getAll( 'translation[22999570][]' ) ).toEqual( [ 'Name: Z → A' ] );
		expect( byId[ '32887665' ].getAll( 'translation[32887665][]' ) ).toEqual( [ '%d taxonomy deleted.', '%d taxonomies deleted.' ] );
	} );

	test( 'swap the saved row in and colour it', async ( { page } ) => {
		let response;
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( isSave( request ) ) {
					await route.fulfill( { contentType: 'application/json', body: response } );
					return true;
				}
			},
		} );
		const oldId = await rowId( page, 'untranslated singular' );
		response = await savedRowsJson( page, 'untranslated singular' );

		await tick( page, 'untranslated singular' );
		await copyButton( page ).click();

		await expect( status( page ) ).toHaveText( 'Saved 1.' );
		await expect( page.locator( `#preview-${ oldId }, #editor-${ oldId }` ) ).toHaveCount( 0 );
		await expect( row( page, 'untranslated singular' ) ).toHaveAttribute( 'row', `${ oldId }-999` );
		await expect( row( page, 'untranslated singular' ).locator( 'td.translation' ) ).toHaveCSS( 'color', GREEN );
	} );

	test( 'mark and untick a row whose translation already exists', async ( { page } ) => {
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( isSave( request ) ) {
					// GlotPress reports this as plain text with HTTP 200.
					await route.fulfill( { body: IDENTICAL } );
					return true;
				}
			},
		} );

		await tick( page, 'untranslated singular' );
		await copyButton( page ).click();

		await expect( status( page ) ).toHaveText( 'Saved 0 · 1 already existed.' );
		await expect( row( page, 'untranslated singular' ) ).toHaveCSS( 'outline-color', AMBER );
		await expect( row( page, 'untranslated singular' ).locator( 'input' ) ).not.toBeChecked();
	} );

	test( 'mark a failed row with the error', async ( { page } ) => {
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( isSave( request ) ) {
					await route.fulfill( { status: 403, contentType: 'text/html', body: '<html><body><p>Forbidden</p></body></html>' } );
					return true;
				}
			},
		} );

		await tick( page, 'untranslated singular' );
		await copyButton( page ).click();

		await expect( status( page ) ).toHaveText( 'Saved 0 · 1 failed (hover the row, or see the console).' );
		await expect( row( page, 'untranslated singular' ) ).toHaveCSS( 'outline-color', RED );
		await expect( row( page, 'untranslated singular' ) ).toHaveAttribute( 'title', 'Save failed: HTTP 403: Forbidden' );
	} );

	test( 'retry once, 2 seconds after a server error', async ( { page } ) => {
		await page.clock.install();
		let saves = 0;
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( isSave( request ) ) {
					saves++;
					await route.fulfill( 1 === saves ? { status: 503, body: 'Busy' } : { body: IDENTICAL } );
					return true;
				}
			},
		} );

		await tick( page, 'untranslated singular' );
		await copyButton( page ).click();
		await expect.poll( () => saves ).toBe( 1 );
		await page.clock.runFor( 1999 );
		expect( saves ).toBe( 1 );
		await page.clock.runFor( 1 );

		await expect( status( page ) ).toHaveText( 'Saved 0 · 1 already existed.' );
		expect( saves ).toBe( 2 );
	} );

	test( 'run 4 at a time, and Stop finishes those and halts the rest', async ( { page } ) => {
		let inFlight = 0;
		let maxInFlight = 0;
		let release;
		const released = new Promise( ( resolve ) => {
			release = resolve;
		} );
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( isSave( request ) ) {
					maxInFlight = Math.max( maxInFlight, ++inFlight );
					await released;
					inFlight--;
					await route.fulfill( { body: IDENTICAL } );
					return true;
				}
			},
		} );

		for ( const checkbox of await page.locator( 'tbody input[name="selected-row[]"]' ).all() ) {
			await checkbox.check();
		}
		await copyButton( page ).click();
		await expect.poll( () => inFlight ).toBe( 4 );
		await page.getByRole( 'button', { name: 'Stop' } ).click();
		await expect( status( page ) ).toHaveText( 'Stopping…' );
		release();

		await expect( status( page ) ).toHaveText( 'Saved 0 · 4 already existed. Stopped with 6 left.' );
		expect( maxInFlight ).toBe( 4 );
		await expect( page.getByRole( 'button', { name: 'Stop' } ) ).toBeHidden();
	} );
} );

test.describe( 'import for large batches', () => {
	// Add untranslated rows so the batch is over IMPORT_THRESHOLD (100).
	// The first has characters a PO string must escape; the last has an empty
	// tag list, which the import can't be sure about.
	const addRows = ( page ) => page.evaluate( () => {
		const preview = document.querySelector( 'tr.preview[data-fixture="untranslated singular"]' );
		const editor = document.getElementById( 'editor-' + preview.getAttribute( 'row' ) );
		for ( let i = 0; i < 101; i++ ) {
			const id = String( 800000 + i );
			const p = preview.cloneNode( true );
			const e = editor.cloneNode( true );
			p.id = 'preview-' + id;
			p.setAttribute( 'row', id );
			p.dataset.fixture = 'added ' + i;
			e.id = 'editor-' + id;
			e.setAttribute( 'row', id );
			e.querySelector( '.original-raw' ).textContent = 0 === i ? 'Say "hi" \\ there\nnow\ttab' : 'Added ' + i;
			if ( 100 === i ) {
				p.querySelector( 'td.original' ).insertAdjacentHTML( 'beforeend', '<div class="original-tags"></div>' );
			}
			preview.parentNode.append( p, e );
		}
	} );

	test( 'submits one PO file and reports what was skipped', async ( { page } ) => {
		await page.clock.install();
		let po = '';
		const saves = [];
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( 'POST' === request.method() && IMPORT_URL === request.url() ) {
					po = request.postDataBuffer().toString( 'utf8' );
					// On success GlotPress redirects to the set, with a notice.
					await route.fulfill( {
						headers: { 'x-test-redirected-to': SET_URL },
						contentType: 'text/html',
						body: SET_HTML.replace( '<body>', '<body><div class="notice">102 translations were added</div>' ),
					} );
					return true;
				}
				if ( isSave( request ) ) {
					saves.push( new URLSearchParams( request.postData() ).get( 'original_id' ) );
					await route.fulfill( { body: IDENTICAL } );
					return true;
				}
			},
		} );
		await addRows( page );

		await page.getByRole( 'button', { name: 'Select untranslated' } ).click();
		await tick( page, 'context and priority' );
		await copyButton( page ).click();

		// 3 untranslated + 100 added + 1 with context go in the file.
		await expect( status( page ) ).toHaveText( '102 translations were added · 2 already translated, skipped · Saved 0 · 1 already existed — reloading…' );
		expect( po.match( /^msgid "/gm ) ).toHaveLength( 1 + 104 );
		expect( po ).toMatch( /name="_gp_route_nonce"\r\n\r\ntest-import-nonce\r\n/ );
		expect( po ).toMatch( /name="status"\r\n\r\ncurrent\r\n/ );
		expect( po ).toMatch( /name="format"\r\n\r\npo\r\n/ );
		expect( po ).not.toContain( 'name="submit"' );
		expect( po ).toContain( 'msgctxt "Pattern title"\nmsgid "Centered Header Menu"\nmsgstr "Centered Header Menu"\n' );
		expect( po ).toContain( 'msgctxt "Google Font Name and Variants"\nmsgid "Noto Serif:400,400i,700,700i"\n' );
		expect( po ).toContain( 'msgid "%d day free trial"\nmsgid_plural "%d day free trial"\nmsgstr[0] "%d day free trial"\nmsgstr[1] "%d day free trial"\n' );
		expect( po ).toContain( 'msgid "Say \\"hi\\" \\\\ there\\nnow\\ttab"\n' );
		// The row with an empty tag list goes row by row instead.
		expect( po ).not.toContain( '"Added 100"' );
		expect( saves ).toEqual( [ '800100' ] );

		const reload = page.waitForEvent( 'framenavigated' );
		await page.clock.runFor( 3000 );
		await reload;
	} );

	test( 'falls back to row-by-row when the import is rejected', async ( { page } ) => {
		let saves = 0;
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( 'POST' === request.method() && IMPORT_URL === request.url() ) {
					// On failure GlotPress redirects back to the import page.
					await route.fulfill( { headers: { 'x-test-redirected-to': IMPORT_URL }, contentType: 'text/html', body: IMPORT_HTML } );
					return true;
				}
				if ( isSave( request ) ) {
					saves++;
					await route.fulfill( { body: IDENTICAL } );
					return true;
				}
			},
		} );
		await addRows( page );

		await page.getByRole( 'button', { name: 'Select untranslated' } ).click();
		await copyButton( page ).click();

		await expect( status( page ) ).toHaveText( 'Saved 0 · 104 already existed.' );
		expect( saves ).toBe( 104 );
	} );

	// Regression: a "Priority: high" bubble with no context was sent as the
	// context, so the import couldn't match the string and silently skipped it.
	test( 'a row with only a priority tag is saved row by row', async ( { page } ) => {
		let po = '';
		const saves = [];
		await openSet( page, {
			handle: async ( route, request ) => {
				if ( 'POST' === request.method() && IMPORT_URL === request.url() ) {
					po = request.postDataBuffer().toString( 'utf8' );
					await route.fulfill( {
						headers: { 'x-test-redirected-to': SET_URL },
						contentType: 'text/html',
						body: SET_HTML.replace( '<body>', '<body><div class="notice">103 translations were added</div>' ),
					} );
					return true;
				}
				if ( isSave( request ) ) {
					saves.push( new URLSearchParams( request.postData() ).get( 'original_id' ) );
					await route.fulfill( { body: IDENTICAL } );
					return true;
				}
			},
		} );
		await addRows( page );

		await page.getByRole( 'button', { name: 'Select untranslated' } ).click();
		await tick( page, 'priority only' );
		await copyButton( page ).click();
		await expect( status( page ) ).toContainText( 'Saved 0 · 2 already existed' );

		expect( po ).not.toContain( 'html_lang_attribute' );
		expect( po ).not.toContain( 'Priority: high' );
		expect( saves.sort() ).toEqual( [ '2379367', '800100' ] );
	} );
} );
