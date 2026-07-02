// ==UserScript==
// @name         GlotPress: en_GB
// @namespace    http://tampermonkey.net/
// @version      0.4.2
// @description  Utilities for English-variant locales: colour-codes translations that match/differ from the en-US original, and adds a bulk "Copy original & save" action so untouched strings can be submitted in seconds. A matching translation does NOT mean it is accurate for the locale, only that it hasn't changed from the original.
// @author       Gary Jones
// @match        https://translate.wordpress.org/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=wordpress.org
// @grant        none
// @homepageURL  https://github.com/GaryJones/glotpress-english-variant-utilities
// @supportURL   https://github.com/GaryJones/glotpress-english-variant-utilities/issues
// @downloadURL  https://raw.githubusercontent.com/GaryJones/glotpress-english-variant-utilities/main/glotpress-en_gb.user.js
// @updateURL    https://raw.githubusercontent.com/GaryJones/glotpress-english-variant-utilities/main/glotpress-en_gb.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Bulk runs above this size are sent as a single PO import request;
    // smaller runs use per-row saves, which update rows in place.
    const IMPORT_THRESHOLD = 10;
    // Number of per-row save requests in flight at once (row-by-row path
    // only). Be kind to wordpress.org.
    const CONCURRENCY = 4;
    // Retry a per-row save once on rate-limit/server errors, after this
    // many milliseconds.
    const MAX_RETRIES = 1;
    const RETRY_DELAY_MS = 2000;

    const table = document.getElementById( 'translations' );
    if ( ! table || window.gpEnGbUtils ) {
        return;
    }

    /* ------------------------------------------------------------------
     * Part 1: colour-code translations that match/differ from the original.
     * ------------------------------------------------------------------ */

    function colourRow( row ) {
        const translationCell = row.querySelector( 'td.translation' );

        // Untranslated rows have no .translation-text, so are skipped.
        if ( ! translationCell || ! translationCell.querySelector( '.translation-text' ) ) {
            return;
        }

        const originalCell = row.querySelector( 'td.original' );
        if ( ! originalCell ) {
            return;
        }

        // GlotPress adds chrome that isn't part of the string: context tags
        // (.original-tags, original cell only) and whitespace-indicator glyphs
        // — → for a tab, ↵ for a newline — wrapped in .invisibles /
        // .invisible-spaces spans in both cells. Hide all of it before
        // measuring, since innerText excludes hidden content, then restore it.
        //
        // We hide the glyph spans rather than string-replacing → and ↵, so
        // that literal arrow characters which are genuinely part of the string
        // are preserved. Otherwise a string such as "Settings → Connectors"
        // has its arrow stripped from the original but not the translation,
        // and is wrongly flagged as differing (shown red).
        const measure = ( cell ) => {
            const chrome = [ ...cell.querySelectorAll( '.original-tags, .invisibles, .invisible-spaces' ) ];
            const previousDisplays = chrome.map( ( el ) => el.style.display );
            chrome.forEach( ( el ) => {
                el.style.display = 'none';
            } );
            const text = cell.innerText;
            chrome.forEach( ( el, i ) => {
                el.style.display = previousDisplays[ i ];
            } );
            return text;
        };

        // We compare the whole table cells (including the "Singular" and
        // "Plural" labels, which appear in both).
        const matches = measure( translationCell ) === measure( originalCell );
        translationCell.style.color = matches ? 'green' : 'red';
        translationCell.title = matches ? 'Same as original' : 'Differs from original';
    }

    function colourAllRows() {
        table.querySelectorAll( 'tbody tr.preview' ).forEach( colourRow );
    }

    /* ------------------------------------------------------------------
     * Part 2: bulk "copy original as translation and save".
     *
     * GlotPress renders a hidden editor <tr> for every row, containing the
     * raw original string and a per-row save nonce. Two submission paths:
     *
     * - Row-by-row: POST to the translation-set URL with original_id,
     *   _gp_route_nonce and translation[<id>][] values — the same request
     *   the editor's Save button makes. The response is a JSON map of
     *   original_id => fresh row HTML, which we swap in just like
     *   GlotPress does.
     * - Import: for larger batches, build a PO file of original => copy
     *   pairs and submit it to the set's import-translations endpoint in
     *   one request, avoiding any chance of rate limiting.
     * ------------------------------------------------------------------ */

    let stopRequested = false;
    let running = false;

    function saveUrl() {
        if ( window.$gp_editor_options && window.$gp_editor_options.url ) {
            return window.$gp_editor_options.url;
        }

        // POSTing to the translation-set URL itself saves a translation.
        return location.pathname;
    }

    function sleep( ms ) {
        return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
    }

    function stripHtml( html ) {
        return ( new DOMParser().parseFromString( html, 'text/html' ).body.textContent || '' ).trim();
    }

    function firstMatch( root, selectors ) {
        for ( const selector of selectors ) {
            const el = root.querySelector( selector );
            if ( el ) {
                return el;
            }
        }
        return null;
    }

    // The raw original string(s), exactly as the editor's own Copy button
    // sources them. translate.wordpress.org uses .original-raw; vanilla
    // GlotPress uses .original_raw.
    function originalTexts( editor ) {
        const singularEl = firstMatch( editor, [
            '.source-string__singular .original-raw',
            '.source-string__singular .original_raw',
        ] );
        const pluralEl = firstMatch( editor, [
            '.source-string__plural .original-raw',
            '.source-string__plural .original_raw',
        ] );

        if ( singularEl ) {
            return {
                singular: singularEl.textContent,
                plural: pluralEl ? pluralEl.textContent : null,
            };
        }

        const raws = editor.querySelectorAll( '.original-raw, .original_raw' );
        if ( ! raws.length ) {
            throw new Error( 'Original text not found' );
        }

        return {
            singular: raws[ 0 ].textContent,
            plural: raws.length > 1 ? raws[ 1 ].textContent : null,
        };
    }

    // The original's context, needed for msgctxt when importing. Rendered
    // as <span class="original-tags"><span class="context bubble">…</span>.
    function rowContext( previewRow ) {
        const tags = previewRow.querySelector( '.original-tags' );
        if ( ! tags ) {
            return { context: null, uncertain: false };
        }

        const inner = tags.querySelector( '.context' );
        if ( inner ) {
            return { context: inner.textContent, uncertain: false };
        }

        const text = tags.textContent.trim();
        const labelled = text.match( /^Context:\s*(.*)$/s );
        if ( labelled ) {
            return { context: labelled[ 1 ], uncertain: false };
        }

        // A tag we don't recognise: let the row-by-row path handle this
        // row, since that addresses originals by id rather than content.
        return { context: text, uncertain: ! text };
    }

    /* ---------------------- Row-by-row engine ------------------------- */

    async function submitRow( rowId, attempt = 0 ) {
        const editor = document.getElementById( 'editor-' + rowId );
        if ( ! editor ) {
            throw new Error( 'Editor row not found' );
        }

        // Rows with an existing translation have a row id of
        // "<originalId>-<translationId>"; the save endpoint wants only the
        // original id.
        const originalId = String( rowId ).split( '-' )[ 0 ];

        const saveButton = firstMatch( editor, [ '.translation-actions__save', 'button.save' ] );
        const nonce = saveButton && saveButton.dataset.nonce;
        if ( ! nonce ) {
            throw new Error( 'Save nonce not found' );
        }

        const groups = editor.querySelectorAll( '.textareas' );
        if ( ! groups.length ) {
            throw new Error( 'No translation textareas found' );
        }

        const sources = originalTexts( editor );

        const params = new URLSearchParams();
        params.append( 'original_id', originalId );
        params.append( '_gp_route_nonce', nonce );

        groups.forEach( ( group, index ) => {
            const textarea = group.querySelector( 'textarea' );
            if ( ! textarea ) {
                return;
            }

            const pluralIndex = parseInt( group.dataset.pluralIndex ?? index, 10 ) || 0;
            const text = ( 0 === pluralIndex || null === sources.plural ) ? sources.singular : sources.plural;

            // Also fill the textarea so the page stays consistent if the
            // row replacement fails for any reason.
            textarea.value = text;
            params.append( textarea.name, text );
        } );

        const response = await fetch( saveUrl(), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: params.toString(),
        } );

        if ( ( 429 === response.status || response.status >= 500 ) && attempt < MAX_RETRIES ) {
            await sleep( RETRY_DELAY_MS * ( attempt + 1 ) );
            return submitRow( rowId, attempt + 1 );
        }

        const body = await response.text();

        if ( ! response.ok ) {
            throw new Error( 'HTTP ' + response.status + ': ' + stripHtml( body ).slice( 0, 200 ) );
        }

        let data;
        try {
            data = JSON.parse( body );
        } catch ( e ) {
            // GlotPress reports some errors as plain text with HTTP 200.
            if ( body.includes( 'Identical current or waiting translation already exists' ) ) {
                markRowSkipped( rowId );
                return 'skipped';
            }
            throw new Error( stripHtml( body ).slice( 0, 200 ) || 'Unexpected response' );
        }

        const html = data[ originalId ] ?? Object.values( data )[ 0 ];
        if ( ! html ) {
            throw new Error( 'Empty response' );
        }

        replaceRow( rowId, html );
        return 'saved';
    }

    async function perRowLoop( rowIds, results ) {
        const queue = [ ...rowIds ];
        const total = rowIds.length;
        let done = 0;

        setStatus( 'Submitting 0/' + total + '…' );

        const workers = Array.from( { length: Math.min( CONCURRENCY, queue.length ) }, async () => {
            while ( queue.length && ! stopRequested ) {
                const rowId = queue.shift();
                try {
                    const outcome = await submitRow( rowId );
                    results[ outcome ]++;
                } catch ( err ) {
                    results.failed++;
                    markRowFailed( rowId, err.message );
                    console.error( '[GlotPress en_GB] Row ' + rowId + ':', err );
                }
                done++;
                setStatus( 'Submitting ' + done + '/' + total + '…' );
            }
        } );

        await Promise.all( workers );

        return queue.length;
    }

    /* ------------------------ Import engine --------------------------- */

    function poString( text ) {
        return '"' + text
            .replaceAll( '\\', '\\\\' )
            .replaceAll( '"', '\\"' )
            .replaceAll( '\t', '\\t' )
            .replaceAll( '\r', '\\r' )
            .replaceAll( '\n', '\\n' ) + '"';
    }

    function buildPo( items ) {
        const lines = [
            'msgid ""',
            'msgstr ""',
            '"MIME-Version: 1.0\\n"',
            '"Content-Type: text/plain; charset=UTF-8\\n"',
            '"Content-Transfer-Encoding: 8bit\\n"',
            '"Plural-Forms: nplurals=2; plural=n != 1;\\n"',
        ];

        items.forEach( ( item ) => {
            lines.push( '' );
            if ( null !== item.context ) {
                lines.push( 'msgctxt ' + poString( item.context ) );
            }
            lines.push( 'msgid ' + poString( item.singular ) );
            if ( null !== item.plural ) {
                lines.push( 'msgid_plural ' + poString( item.plural ) );
                lines.push( 'msgstr[0] ' + poString( item.singular ) );
                lines.push( 'msgstr[1] ' + poString( item.plural ) );
            } else {
                lines.push( 'msgstr ' + poString( item.singular ) );
            }
        } );

        return lines.join( '\n' ) + '\n';
    }

    // Submit a batch as one PO file to the set's import endpoint. The
    // import form is fetched first so the nonce and any extra fields the
    // site expects are always current.
    async function importStrings( items ) {
        const importUrl = saveUrl().replace( /\/?$/, '/' ) + 'import-translations/';

        const pageResponse = await fetch( importUrl, { credentials: 'same-origin' } );
        if ( ! pageResponse.ok ) {
            throw new Error( 'Import page unavailable (HTTP ' + pageResponse.status + ')' );
        }

        const pageDoc = new DOMParser().parseFromString( await pageResponse.text(), 'text/html' );
        const form = [ ...pageDoc.querySelectorAll( 'form' ) ].find( ( f ) => f.querySelector( 'input[type="file"]' ) );
        if ( ! form ) {
            throw new Error( 'Import form not found (insufficient permissions?)' );
        }

        const body = new FormData();

        [ ...form.elements ].forEach( ( el ) => {
            if ( ! el.name || 'file' === el.type || 'submit' === el.type || 'button' === el.type ) {
                return;
            }
            if ( ( 'checkbox' === el.type || 'radio' === el.type ) && ! el.checked ) {
                return;
            }
            body.set( el.name, el.value );
        } );

        const statusSelect = form.querySelector( 'select[name="status"]' );
        const canImportCurrent = statusSelect && [ ...statusSelect.options ].some( ( o ) => 'current' === o.value );
        if ( statusSelect ) {
            body.set( 'status', canImportCurrent ? 'current' : statusSelect.value );
        }
        body.set( 'format', 'po' );

        const fileField = form.querySelector( 'input[type="file"]' );
        body.set(
            ( fileField && fileField.name ) || 'import-file',
            new File( [ buildPo( items ) ], 'bulk-copy-original.po', { type: 'text/x-gettext-translation' } )
        );

        const action = form.getAttribute( 'action' );
        const postUrl = action ? new URL( action, pageResponse.url ).href : pageResponse.url;

        const response = await fetch( postUrl, {
            method: 'POST',
            credentials: 'same-origin',
            body,
        } );

        const html = await response.text();
        if ( ! response.ok ) {
            throw new Error( 'HTTP ' + response.status + ': ' + stripHtml( html ).slice( 0, 200 ) );
        }

        const doc = new DOMParser().parseFromString( html, 'text/html' );

        // On failure GlotPress redirects back to the import page; on
        // success it redirects to the translation-set page.
        if ( response.url.includes( 'import-translations' ) ) {
            const error = doc.querySelector( '.error, .notice' );
            throw new Error( error ? error.textContent.trim().slice( 0, 200 ) : 'Import rejected' );
        }

        // GlotPress's only success signal is "<n> translations were added" — a
        // bulk count that says nothing about strings it declined to create (an
        // approved or identical translation already existed for them). Work the
        // shortfall out from the number we submitted so the run reports it,
        // matching the per-row path's "already existed" feedback.
        const notices = [ ...doc.querySelectorAll( '.notice' ) ]
            .map( ( el ) => el.textContent.trim() )
            .filter( Boolean );
        const notice = notices.find( ( t ) => /translations?\s+(?:was|were)\s+added/i.test( t ) )
            || notices[ 0 ]
            || 'Import finished';

        const added = notice.match( /([\d,]+)\s+translations?\s+(?:was|were)\s+added/i );
        if ( added ) {
            const skipped = Math.max( 0, items.length - parseInt( added[ 1 ].replace( /,/g, '' ), 10 ) );
            if ( skipped ) {
                return notice.slice( 0, 160 ) + ' · ' + skipped + ' already translated, skipped';
            }
        }
        return notice.slice( 0, 200 );
    }

    /* ------------------------- Bulk runner ---------------------------- */

    function selectedCheckboxes() {
        return [ ...table.querySelectorAll( 'tbody tr.preview input[name="selected-row[]"]:checked' ) ];
    }

    async function runBulk() {
        if ( running ) {
            return;
        }

        const rowIds = selectedCheckboxes()
            .map( ( cb ) => cb.closest( 'tr' ).getAttribute( 'row' ) )
            .filter( Boolean );

        if ( ! rowIds.length ) {
            setStatus( 'No rows selected.' );
            return;
        }

        running = true;
        stopRequested = false;
        copyButton.disabled = true;
        selectButton.disabled = true;
        stopButton.style.display = '';

        const results = { saved: 0, skipped: 0, failed: 0 };
        const importable = [];
        const perRowIds = [];

        rowIds.forEach( ( rowId ) => {
            try {
                const editor = document.getElementById( 'editor-' + rowId );
                const preview = document.getElementById( 'preview-' + rowId );
                if ( ! editor || ! preview ) {
                    throw new Error( 'Row not found' );
                }

                const sources = originalTexts( editor );
                const { context, uncertain } = rowContext( preview );

                if ( uncertain ) {
                    perRowIds.push( rowId );
                } else {
                    importable.push( { rowId, singular: sources.singular, plural: sources.plural, context } );
                }
            } catch ( err ) {
                results.failed++;
                markRowFailed( rowId, err.message );
                console.error( '[GlotPress en_GB] Row ' + rowId + ':', err );
            }
        } );

        let importNotice = null;

        if ( importable.length > IMPORT_THRESHOLD ) {
            try {
                setStatus( 'Importing ' + importable.length + ' strings in one request…' );
                importNotice = await importStrings( importable );
            } catch ( err ) {
                console.error( '[GlotPress en_GB] Import failed; falling back to row-by-row.', err );
                setStatus( 'Import failed (' + err.message + ') — falling back to row-by-row…' );
                perRowIds.push( ...importable.map( ( item ) => item.rowId ) );
            }
        } else {
            perRowIds.push( ...importable.map( ( item ) => item.rowId ) );
        }

        let stoppedWith = 0;
        if ( perRowIds.length && ! stopRequested ) {
            stoppedWith = await perRowLoop( perRowIds, results );
        }

        const parts = [];
        if ( importNotice ) {
            parts.push( importNotice );
        }
        if ( perRowIds.length ) {
            parts.push( 'Saved ' + results.saved );
            if ( results.skipped ) {
                parts.push( results.skipped + ' already existed' );
            }
        }
        if ( results.failed ) {
            parts.push( results.failed + ' failed (hover the row, or see the console)' );
        }
        const remaining = stoppedWith ? ' Stopped with ' + stoppedWith + ' left.' : '';

        // After an import the visible rows are stale, so reload to show the
        // fresh state — unless something failed and its marker would be lost.
        if ( importNotice && ! results.failed && ! stoppedWith ) {
            setStatus( parts.join( ' · ' ) + ' — reloading…' );
            await sleep( 3000 );
            location.reload();
            return;
        }

        setStatus( parts.join( ' · ' ) + '.' + remaining );

        running = false;
        copyButton.disabled = false;
        selectButton.disabled = false;
        stopButton.style.display = 'none';
        updateCount();
    }

    /* ------------------------- Row feedback --------------------------- */

    function replaceRow( rowId, html ) {
        const preview = document.getElementById( 'preview-' + rowId );
        const editor = document.getElementById( 'editor-' + rowId );
        if ( ! preview || ! editor ) {
            return;
        }

        // Same-origin server-rendered row HTML — the same fragment GlotPress
        // itself swaps in after a save. Parsed inertly via <template>, and any
        // script elements are dropped before the rows are inserted.
        const template = document.createElement( 'template' );
        template.innerHTML = html.trim();
        template.content.querySelectorAll( 'script' ).forEach( ( el ) => el.remove() );

        let rows = [ ...template.content.children ].filter( ( el ) => 'TR' === el.tagName );
        if ( ! rows.length ) {
            const tbody = template.content.querySelector( 'tbody' );
            if ( tbody ) {
                rows = [ ...tbody.children ].filter( ( el ) => 'TR' === el.tagName );
            }
        }

        if ( ! rows.length ) {
            // Couldn't parse the response: mark the row saved visually instead.
            preview.style.outline = '2px solid #00a32a';
            preview.title = 'Saved (reload to see the result)';
            return;
        }

        rows.forEach( ( tr ) => preview.parentNode.insertBefore( tr, preview ) );
        editor.remove();
        preview.remove();

        rows.filter( ( tr ) => tr.classList.contains( 'preview' ) ).forEach( ( tr ) => {
            colourRow( tr );
            flashRow( tr );
        } );
    }

    function flashRow( tr ) {
        tr.style.transition = 'background-color 1.5s ease-out';
        tr.style.backgroundColor = '#b8e6bf';
        setTimeout( () => {
            tr.style.backgroundColor = '';
        }, 1500 );
    }

    function markRowFailed( rowId, message ) {
        const preview = document.getElementById( 'preview-' + rowId );
        if ( ! preview ) {
            return;
        }
        preview.style.outline = '2px solid #d63638';
        preview.title = 'Save failed: ' + message;
    }

    function markRowSkipped( rowId ) {
        const preview = document.getElementById( 'preview-' + rowId );
        if ( ! preview ) {
            return;
        }
        preview.style.outline = '2px solid #dba617';
        preview.title = 'Skipped: an identical translation already exists';
        const checkbox = preview.querySelector( 'input[name="selected-row[]"]' );
        if ( checkbox ) {
            checkbox.checked = false;
        }
    }

    /* ------------------------------------------------------------------
     * Toolbar.
     * ------------------------------------------------------------------ */

    let copyButton, selectButton, stopButton, countEl, statusEl;

    function setStatus( message ) {
        statusEl.textContent = message;
    }

    function updateCount() {
        countEl.textContent = selectedCheckboxes().length;
    }

    function buildToolbar() {
        const style = document.createElement( 'style' );
        style.textContent = '.gp-en-gb-toolbar { display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; } .gp-en-gb-status { font-size: 13px; }';
        document.head.appendChild( style );

        const toolbar = document.createElement( 'div' );
        toolbar.className = 'gp-en-gb-toolbar';

        selectButton = document.createElement( 'button' );
        selectButton.type = 'button';
        selectButton.className = 'button';
        selectButton.textContent = 'Select untranslated';
        selectButton.title = 'Tick every untranslated row (other rows are left as they are)';
        selectButton.addEventListener( 'click', () => {
            table.querySelectorAll( 'tbody tr.preview.untranslated input[name="selected-row[]"]' ).forEach( ( cb ) => {
                cb.checked = true;
            } );
            updateCount();
            setStatus( '' );
        } );

        copyButton = document.createElement( 'button' );
        copyButton.type = 'button';
        copyButton.className = 'button is-primary';
        copyButton.title = 'For each ticked row, submit the original en-US string as the translation';
        countEl = document.createElement( 'span' );
        countEl.textContent = '0';
        copyButton.append( 'Copy original & save (', countEl, ')' );
        copyButton.addEventListener( 'click', runBulk );

        stopButton = document.createElement( 'button' );
        stopButton.type = 'button';
        stopButton.className = 'button';
        stopButton.textContent = 'Stop';
        // Inline style, not the hidden attribute: site CSS sets a display on
        // .button which would override [hidden].
        stopButton.style.display = 'none';
        stopButton.addEventListener( 'click', () => {
            stopRequested = true;
            setStatus( 'Stopping…' );
        } );

        statusEl = document.createElement( 'span' );
        statusEl.className = 'gp-en-gb-status';
        statusEl.setAttribute( 'aria-live', 'polite' );

        toolbar.append( selectButton, copyButton, stopButton, statusEl );
        table.parentNode.insertBefore( toolbar, table );

        // Keep the count fresh: row checkbox changes bubble, and GlotPress's
        // own select-all sets the others before the change event lands here.
        table.addEventListener( 'change', updateCount );
    }

    /* ------------------------------------------------------------------
     * Boot.
     * ------------------------------------------------------------------ */

    colourAllRows();

    // Re-colour when GlotPress replaces rows (e.g. a manual save in the editor).
    const tbody = table.querySelector( 'tbody' );
    if ( tbody ) {
        let scheduled = null;
        new MutationObserver( () => {
            clearTimeout( scheduled );
            scheduled = setTimeout( () => {
                colourAllRows();
                if ( countEl ) {
                    updateCount();
                }
            }, 250 );
        } ).observe( tbody, { childList: true } );
    }

    // Only offer bulk actions when row checkboxes exist (i.e. the user has
    // bulk permissions on this translation set).
    if ( table.querySelector( 'tbody input[name="selected-row[]"]' ) ) {
        buildToolbar();
        updateCount();
    }

    window.gpEnGbUtils = { runBulk, submitRow, colourRows: colourAllRows };
})();
