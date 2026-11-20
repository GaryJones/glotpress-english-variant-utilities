// Rebuilds tests/fixtures/set.html from public translate.wordpress.org pages.
// Run with: node tests/fixtures/capture.mjs
//
// Preview rows are the same whether or not you're logged in, so they're
// captured as-is. Logged-out editor rows have no save button or checkbox, so
// those parts are rebuilt to match the logged-in markup (with fake nonces).
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const host = 'https://translate.wordpress.org';
const core = '/projects/wp/dev/en-gb/default/';
const woo = '/projects/wp-plugins/woocommerce/dev/en-gb/default/';
const q = ( params ) => '?' + new URLSearchParams( params ).toString();

// [ label, page, row picker (runs in the page) ]
const picks = [
	[ 'untranslated singular', woo + q( { 'filters[status]': 'untranslated' } ), 'single' ],
	[ 'untranslated plural', woo + q( { 'filters[status]': 'untranslated', 'filters[term]': 'day free trial' } ), 'plural' ],
	[ 'untranslated with context', woo + q( { 'filters[status]': 'untranslated', 'filters[term]': 'Centered Header Menu' } ), 'context' ],
	[ 'arrow, identical', core + q( { 'filters[status]': 'either', 'filters[term]': 'Name: Z →' } ), 'any' ],
	[ 'differs (US to UK spelling)', core + q( { 'filters[status]': 'current', 'filters[term]': 'Background color' } ), 'differs' ],
	[ 'context and priority', core + q( { 'filters[status]': 'current', 'sort[by]': 'priority', 'sort[how]': 'desc' } ), 'context' ],
	[ 'priority only', core + q( { 'filters[status]': 'current', 'sort[by]': 'priority', 'sort[how]': 'desc' } ), 'priorityOnly' ],
	[ 'translated plural', core + q( { 'filters[status]': 'current', 'filters[term]': 'taxonomy deleted.' } ), 'plural' ],
	[ 'trailing space', core + q( { 'filters[status]': 'current', 'filters[term]': 'Could not execute:' } ), 'any' ],
	[ 'newline glyphs', core + q( { 'filters[status]': 'current', 'filters[term]': 'This notice confirms that the admin email address was changed' } ), 'any' ],
];

const browser = await chromium.launch();
const page = await browser.newPage();
const rows = [];

// Be gentle: translate.wordpress.org answers bursts with HTTP 429.
async function load( url ) {
	for ( let attempt = 1; attempt <= 5; attempt++ ) {
		const response = await page.goto( url );
		if ( 429 !== response.status() ) {
			return;
		}
		await page.waitForTimeout( 15000 * attempt );
	}
	throw new Error( 'Still rate limited: ' + url );
}

for ( const [ label, url, kind ] of picks ) {
	// Neighbouring picks share a page, so only load it once.
	if ( page.url() !== host + url ) {
		await load( host + url );
	}
	const html = await page.evaluate( ( [ kind, label ] ) => {
		const previews = [ ...document.querySelectorAll( '#translations tbody tr.preview' ) ];
		const editorOf = ( tr ) => document.getElementById( 'editor-' + tr.getAttribute( 'row' ) );
		const isPlural = ( tr ) => !! editorOf( tr ).querySelector( '.source-string__plural' );
		const tags = ( tr ) => tr.querySelector( '.original-tags' );
		const test = {
			any: () => true,
			single: ( tr ) => ! isPlural( tr ) && ! tags( tr ),
			plural: ( tr ) => isPlural( tr ) && ! tags( tr ),
			context: ( tr ) => ! isPlural( tr ) && tr.querySelector( '.original-tags .context' ),
			priorityOnly: ( tr ) => tags( tr ) && ! tr.querySelector( '.original-tags .context' ),
			differs: ( tr ) => tr.querySelector( '.translation-text' ) && tr.querySelector( '.translation-text' ).textContent !== tr.querySelector( '.original-text' ).textContent,
		}[ kind ];
		const preview = previews.find( test );
		if ( ! preview ) {
			return null;
		}
		const editor = editorOf( preview );
		const originalId = preview.getAttribute( 'row' ).split( '-' )[ 0 ];

		// GlotPress opens the editor when a filter matches one row; undo that.
		preview.removeAttribute( 'style' );
		preview.dataset.fixture = label;
		editor.removeAttribute( 'style' );

		// Logged-in rows start with a bulk-select checkbox.
		const th = document.createElement( 'th' );
		th.scope = 'row';
		th.className = 'checkbox';
		th.innerHTML = '<input type="checkbox" name="selected-row[]">';
		preview.prepend( th );
		const missing = preview.querySelector( '.missing' );
		if ( missing ) {
			missing.textContent = 'Double-click to add';
		}

		editor.querySelectorAll( '.editor-panel__right, .panel-header, .source-details, .suggestions-wrapper, script, style' ).forEach( ( el ) => el.remove() );
		const wrapper = editor.querySelector( '.translation-wrapper' );
		const current = [ ...wrapper.querySelectorAll( 'textarea' ) ].map( ( t ) => t.value );
		const forms = editor.querySelector( '.source-string__plural' ) ? 2 : 1;
		wrapper.innerHTML = Array.from( { length: forms }, ( _, i ) =>
			`<div class="textareas${ i ? '' : ' active' }" data-plural-index="${ i }">` +
			`<textarea placeholder="Enter translation here" class="foreign-text" name="translation[${ originalId }][]" id="translation_${ originalId }_${ i }"></textarea></div>`
		).join( '\n' ) +
			'\n<div class="translation-actions"><div class="translation-actions__primary">' +
			`<button class="button is-primary translation-actions__save with-tooltip" type="button" aria-label="Save and approve translation" data-nonce="test-nonce-${ originalId }">Save</button>` +
			'</div></div>';
		wrapper.querySelectorAll( 'textarea' ).forEach( ( t, i ) => {
			t.textContent = current[ i ] ?? '';
		} );

		// Drop HTML comments and collapse whitespace-only nodes outside the strings.
		const keep = '.original-text, .translation-text, textarea, .original-raw, .invisible-spaces, .invisibles, .bubble';
		for ( const root of [ preview, editor ] ) {
			const walker = document.createTreeWalker( root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT );
			const nodes = [];
			while ( walker.nextNode() ) {
				nodes.push( walker.currentNode );
			}
			nodes.forEach( ( n ) => {
				if ( 8 === n.nodeType ) {
					n.remove();
				} else if ( ! /\S/.test( n.data ) && ! n.parentElement.closest( keep ) ) {
					// Keep one newline unless a neighbour already supplies one.
					n.data = n.previousSibling && 3 === n.previousSibling.nodeType ? '' : '\n';
				}
			} );
		}
		return preview.outerHTML + '\n' + editor.outerHTML;
	}, [ kind, label ] );

	if ( ! html ) {
		throw new Error( 'No row found for: ' + label );
	}
	rows.push( `<!-- ${ label } -->\n${ html }` );
}

await browser.close();

writeFileSync( new URL( './set.html', import.meta.url ), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fixture: translation set</title>
<!-- Captured by tests/fixtures/capture.mjs. Only the styles the userscript's measurements depend on. -->
<style>
.original-text, .translation-text { white-space: pre-wrap; }
tr.editor { display: none; }
</style>
<script>
window.$gp_editor_options = { can_approve: '1', can_write: '1', url: '${ core }' };
</script>
</head>
<body>
<table id="translations" class="translations">
<thead>
<tr><th class="checkbox"><input type="checkbox"></th><th>Prio</th><th class="original">Original string</th><th class="translation">Translation</th><th>&mdash;</th></tr>
</thead>
<tbody>
${ rows.join( '\n' ) }
</tbody>
</table>
</body>
</html>
` );
console.log( 'Wrote set.html with ' + rows.length + ' rows' );
