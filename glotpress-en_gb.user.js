// ==UserScript==
// @name         GlotPress: en_GB
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Useful for easily spotting matching original and translations for English variants. Does NOT mean the translation is accurate for that locale, only that it hasn't changed from the original en-US.
// @author       Gary Jones
// @match        https://translate.wordpress.org/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=wordpress.org
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/GaryJones/glotpress-english-variant-utilities/main/glotpress-en_gb.user.js
// @updateURL    https://raw.githubusercontent.com/GaryJones/glotpress-english-variant-utilities/main/glotpress-en_gb.user.js
// ==/UserScript==

(function() {
    'use strict';

    document.getElementById( 'translations' ).querySelectorAll( '.translation-text' ).forEach(
    function( tt, index, tts ) {
        // Use .closest('.translation') instead of parentNode / parentElement, to account for the different markup for Single/Plural translations.
        const elTranslation = tt.closest( '.translation' );
        const translationText = elTranslation.innerText;

        // We end up comparing the whole table cells (including the "Singular" and "Plural" labels), with HTML,
        // visible whitepsace indicator glyphs and original-tags stripped out.
        const elOriginal = elTranslation.previousElementSibling
        elOriginal.querySelector('.original-tags')?.remove()
        const originalText = elOriginal.innerText.replaceAll( '↵', '' ).replaceAll( '→', '' );

        // Uncomment to debug.
        //console.info( 'TT: ' + translationText );
        //console.log( 'OT: ' + originalText );

        // Not accessible, but it serves me for now.
        if ( translationText !== originalText ) {
            elTranslation.style.color = 'red';
        } else {
            elTranslation.style.color = 'green';
        }
    }
);
})();
