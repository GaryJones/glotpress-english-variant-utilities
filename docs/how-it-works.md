# How it works

The script is a single file, [`glotpress-en_gb.user.js`](../glotpress-en_gb.user.js), with no dependencies. It reads the page GlotPress has already rendered and sends the same requests the editor does. It runs only where `#translations` (the strings table) exists.

## Colouring

For each row with a translation, the script compares the visible text of the original cell with that of the translation cell. It uses `innerText`, which leaves out hidden elements, so it first hides GlotPress's extra markup and restores it afterwards:

- `.original-tags`: the context and priority bubbles.
- `.invisibles`: the ↵ and → glyphs drawn for newlines and tabs.

`.invisible-spaces` is deliberately not hidden. On translate.wordpress.org it wraps real leading, trailing or repeated spaces, and only in the original cell, so hiding it would drop those spaces from one side of the comparison.

`innerText` also ignores CSS on an element that isn't rendered. GlotPress hides a row's preview while its editor is open, so the script shows the row for the moment it measures it. Before 0.4.4, a string with newlines or tabs whose editor was open (including one GlotPress opened automatically because a filter matched only that string) was shown red.

A `MutationObserver` on the table body re-colours rows after GlotPress replaces them.

## Saving a row

Every row in the table has a hidden editor row (`#editor-<rowId>`) holding the raw original text and a per-row save nonce. To save a row, the script:

1. Reads the original from `.source-string__singular .original-raw` (and `__plural` for plurals). Vanilla GlotPress uses `.original_raw`, which also works.
2. Takes the nonce from the editor's save button (`.translation-actions__save[data-nonce]`).
3. Sends `POST` to the translation set URL (`$gp_editor_options.url`) with `original_id`, `_gp_route_nonce`, and one `translation[<originalId>][]` per plural form, in order.

Row ids are `<originalId>` for untranslated rows and `<originalId>-<translationId>` for translated ones; only the original id is sent.

GlotPress answers with a JSON map of original id to the new rows' HTML, which the script swaps into the table. Some errors come back as plain text with HTTP 200, notably "Identical current or waiting translation already exists."; the script treats that as already existing rather than as a failure.

Rows are saved four at a time. A save that gets HTTP 429 or 5xx is retried once, after 2 seconds.

## The import path

Batches of more than 100 rows go through the set's import instead, in a single request:

1. Fetch `<set URL>/import-translations/` to get the import form, its nonce and any other fields.
2. Build a PO file pairing each original with itself, including `msgctxt` for strings with a context, and `msgid_plural` and both `msgstr` forms for plurals.
3. Post it as `multipart/form-data`, with `format=po` and `status=current` when you can approve.
4. GlotPress redirects to the set on success, with a notice such as "102 translations were added", or back to the import page on failure. On failure, the script falls back to saving row by row.

The import differs from row by row saves in ways that matter:

- **Attribution.** Imported translations aren't attributed to the user who submitted them. This is why the threshold is 100 and the import is, in practice, rarely used.
- **Matching.** GlotPress matches each PO entry to an original by its exact text and context. A string with the wrong context isn't matched.
- **Feedback.** GlotPress only reports how many translations it added, never which strings it skipped (because a translation already existed, for example). The script reports the difference between the number submitted and the number added as "already translated, skipped".

The context comes from the `.context` bubble in the row's tags. If a row has tags but no context bubble (only a "Priority: high" bubble, for example), the script saves that row individually instead, since that path addresses originals by id rather than by text. Before 0.4.4, such a row was imported with its tag text as the context, so GlotPress couldn't match it and skipped it.

## Settings

These constants sit at the top of the script:

| Constant | Default | What it does |
| --- | --- | --- |
| `IMPORT_THRESHOLD` | `100` | Batches larger than this use the import path. |
| `CONCURRENCY` | `4` | Row by row saves in flight at once. Be kind to wordpress.org. |
| `MAX_RETRIES` | `1` | Retries for a row that gets HTTP 429 or 5xx. |
| `RETRY_DELAY_MS` | `2000` | Wait before a retry, multiplied by the attempt number. |

Editing them in Tampermonkey works, but the next automatic update replaces your edits.

## Debugging

The script exposes `window.gpEnGbUtils` in the page, with `runBulk()`, `submitRow( rowId )` and `colourRows()`. Errors are logged to the console with the prefix `[GlotPress en_GB]`.
