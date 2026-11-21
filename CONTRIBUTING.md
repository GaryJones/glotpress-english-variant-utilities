# Contributing

Thanks for helping. Issues and pull requests are welcome on [GitHub](https://github.com/GaryJones/glotpress-english-variant-utilities).

The userscript is a single file, [`glotpress-en_gb.user.js`](glotpress-en_gb.user.js), installed straight from `main`. Keep it that way: no build step, no dependencies. Everything else in the repository is for development and is left out of downloads (see `.gitattributes`).

## Running the tests

The tests use [Playwright](https://playwright.dev/). They load a captured translate.wordpress.org page into Chromium, run the unmodified userscript on it, and mock every request, so they never touch the real site.

```sh
npm install
npx playwright install chromium
npm test
```

- `tests/colouring.spec.js` covers match/differ colouring.
- `tests/bulk.spec.js` covers the toolbar, row by row saves, retries, Stop and the import path.
- `tests/helpers.js` loads the fixture and routes requests. Pass `openSet()` a `handle` function to answer a request yourself.

Tests marked `test.fail()` document known bugs. When you fix one, its test starts passing, Playwright reports it as an unexpected pass, and you remove the `test.fail()` line.

### Why a real browser

Colouring relies on `innerText`, which depends on layout and CSS. jsdom doesn't implement it, so a lighter DOM library would test something other than what runs in your browser.

## Fixtures

`tests/fixtures/set.html` holds ten real rows from translate.wordpress.org, each covering one case (labelled with `data-fixture`). `tests/fixtures/import.html` is the import form.

To refresh `set.html`:

```sh
node tests/fixtures/capture.mjs
```

It reads public pages, so it doesn't need you to be logged in. Logged-out pages have no checkboxes or save buttons, so the script rebuilds those parts as they appear when logged in, with fake nonces. Review the diff before committing: the rows it picks can change as strings are translated.

## Making a change

1. Branch from `main`.
2. If you're fixing a bug, add a test that fails without the fix.
3. Run `npm test`.
4. Bump `@version` in the userscript header. Tampermonkey only updates to a higher version, so without a bump nobody gets the change.
5. Update the [docs](docs/README.md) if behaviour changes.
6. Commit your changes, signed (see below).
7. Open a pull request against `main`. Pull requests are merged with a merge commit, so every commit reaches `main` as you wrote it.

Commit messages use [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`fix:`, `feat:`, `docs:`, `test:` and so on), and say why the change was needed.

### Signed commits

`main` only accepts commits with a verified signature, so a pull request containing an unsigned commit can't be merged. Set up signing before you commit, using [GitHub's guide to signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits). If you've already pushed unsigned commits, re-sign them with `git rebase --exec 'git commit --amend --no-edit -S' main`, then force-push your branch.

## Testing on translate.wordpress.org

Saves on translate.wordpress.org are real contributions, and approved straight away if you can approve. Before trying a change against the live site, either pick strings you're happy to submit, or replace `window.fetch` in the page with one that answers `POST` requests itself.
