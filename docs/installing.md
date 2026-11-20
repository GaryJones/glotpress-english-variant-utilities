# Installing and updating

## Installing

1. Install [Tampermonkey](https://www.tampermonkey.net/), or another userscript manager such as Violentmonkey.
2. [Open the raw script](https://raw.githubusercontent.com/GaryJones/glotpress-english-variant-utilities/main/glotpress-en_gb.user.js). Your userscript manager offers to install it.
3. Confirm the install, then reload any open translate.wordpress.org tabs.

The script runs on every page of translate.wordpress.org, but only does anything on translation set pages (those with a table of strings). It works for any English variant locale, not just en_GB.

## Automatic updates

The script declares `@version`, `@downloadURL` and `@updateURL`, so Tampermonkey checks this repository's `main` branch for new releases at its usual interval. To check now, open the Tampermonkey menu and choose Utilities, then "Check for userscript updates".

Tampermonkey only updates to a higher `@version`, so every release bumps it.

## Updating by hand

If you want a version before it reaches `main`, or prefer to paste:

1. Open the Tampermonkey dashboard and edit the "GlotPress: en_GB" script.
2. Replace the entire contents with the new file, and save.

The name and namespace stay the same, so it remains the same script. The update URLs in the pasted header keep automatic updates working; you can confirm this on the script's Settings tab, where the update URL appears alongside the update checkbox.
