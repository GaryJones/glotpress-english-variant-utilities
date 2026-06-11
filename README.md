# glotpress-english-variant-utilities

TamperMonkey script for those handling English-variant locales (en_GB, en_CA, en_AU, en_NZ…) in GlotPress on translate.wordpress.org.

## Features

### Match/differ colouring

On any translation-set page, each translation is compared against its original:

- **Green**: the translation is identical to the en_US original.
- **Red**: the translation differs from the original.

A green string does **not** mean the translation is accurate for the locale, only that it hasn't changed from the original. Colours refresh automatically when rows change (for example after saving in the editor).

### Bulk "Copy original & save"

On pages where you have bulk permissions, a toolbar is added above the translations table:

- **Select untranslated** — ticks every untranslated row on the page (other rows are left alone). The native select-all checkbox in the table header, and shift-click range selection, also work.
- **Copy original & save (n)** — for every ticked row, submits the en_US original as the translation, exactly as if you had opened the editor, pressed Copy, then Save. Rows update in place as they save, with a live progress count and an end summary.
- **Stop** — appears during a run; finishes the in-flight requests and halts the rest.

The intended workflow on a page filtered to untranslated strings:

1. Tick the header checkbox (or **Select untranslated**).
2. Untick the strings that need a genuine en_GB variation (those you translate by hand).
3. Press **Copy original & save**.

How the strings are submitted depends on the batch size:

- **More than 10 rows**: the batch is built into a PO file (including contexts and plurals) and submitted to the set's own import-translations endpoint as a **single request**, so there is no chance of rate limiting. The page reloads a few seconds later to show the fresh state — on an untranslated filter, only the strings you left unticked (plus any newly paged-in strings) remain.
- **10 rows or fewer**: each row is saved individually using the same per-row nonce and endpoint as the editor's own Save button, with rows updating in place. If the import path ever fails, the run automatically falls back to this row-by-row mode.

Permissions and warnings behave exactly as normal — if you can approve, copies are saved and approved (`current`) in one step. Rows that fail are outlined in red with the error in the row tooltip (and logged to the console); rows where an identical translation already exists are outlined in amber and unticked.

Tunables at the top of the script: `IMPORT_THRESHOLD` (batch size above which the single-request import is used) and `CONCURRENCY` (parallel requests for the row-by-row path, four by default to keep load on wordpress.org reasonable).

## Installation

Install [Tampermonkey](https://www.tampermonkey.net/) (or any userscript manager), then [open the raw script](https://raw.githubusercontent.com/GaryJones/glotpress-english-variant-utilities/main/glotpress-en_gb.user.js) to install it.

## Updating

The script declares `@version`, `@downloadURL` and `@updateURL`, so Tampermonkey picks up new releases from this repository's `main` branch automatically (per its update-check interval), or on demand via Utilities → "Check for userscript updates". Each release bumps `@version`; Tampermonkey only updates to a higher version.

If you already have an older copy installed and want this version before it reaches `main` (or just prefer to paste): open the Tampermonkey dashboard, open the "GlotPress: en_GB" script, replace the entire contents with the new file, and save. The name and namespace are unchanged, so it remains the same script, and the update URLs in the pasted header keep future automatic updates working. You can confirm under the script's Settings tab, where the update URL should be shown alongside the update checkbox.
