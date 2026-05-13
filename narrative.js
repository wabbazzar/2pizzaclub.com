// receipts/narrative.js
//
// Loads chapters/narrative.json and injects era + anchor blurbs.
// Toggles via:
//   - URL param: ?prose=on | ?prose=off  (sets and overrides)
//   - LocalStorage key: receipts.prose ("on" | "off")
//   - Header button: cycles state
// Backend kill switch: set "enabled": false in narrative.json. When false, no blurbs render and no toggle appears.

(function () {
    'use strict';

    const STORAGE_KEY = 'receipts.prose';

    function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function readState() {
        const url = new URL(window.location.href);
        const p = url.searchParams.get('prose');
        if (p === 'on' || p === 'off') {
            localStorage.setItem(STORAGE_KEY, p);
            return p;
        }
        return localStorage.getItem(STORAGE_KEY) || 'on';
    }

    function writeState(s) {
        localStorage.setItem(STORAGE_KEY, s);
        document.body.classList.toggle('prose-off', s === 'off');
        const btn = document.getElementById('prose-toggle');
        if (btn) {
            btn.textContent = s === 'on' ? 'prose · on' : 'prose · off';
            btn.setAttribute('aria-pressed', s === 'on' ? 'true' : 'false');
        }
    }

    function injectToggle() {
        const nav = document.querySelector('.header-nav');
        if (!nav || document.getElementById('prose-toggle')) return;
        const btn = document.createElement('button');
        btn.id = 'prose-toggle';
        btn.type = 'button';
        btn.className = 'exit-mark prose-toggle';
        btn.addEventListener('click', () => {
            const next = (localStorage.getItem(STORAGE_KEY) || 'on') === 'on' ? 'off' : 'on';
            writeState(next);
        });
        nav.insertBefore(btn, nav.firstChild);
    }

    function renderEraBlurb(eraDivider, text, draft) {
        if (!text) return;
        const wrap = document.createElement('div');
        wrap.className = 'narrative-blurb narrative-era' + (draft ? ' is-draft' : '');
        wrap.innerHTML = `<p>${escapeHTML(text)}</p>` + (draft ? '<p class="narrative-stamp">// ai draft · replace with your voice</p>' : '');
        eraDivider.appendChild(wrap);
    }

    function renderAnchorBlurb(chapterEl, text, draft) {
        if (!text) return;
        const wrap = document.createElement('div');
        wrap.className = 'narrative-blurb narrative-anchor' + (draft ? ' is-draft' : '');
        wrap.innerHTML = `<p>${escapeHTML(text)}</p>` + (draft ? '<p class="narrative-stamp">// ai draft · replace with your voice</p>' : '');
        const body = chapterEl.querySelector('.chapter-body');
        if (body) body.insertBefore(wrap, body.firstChild);
        else chapterEl.appendChild(wrap);
    }

    async function main() {
        let narrative;
        try {
            narrative = await fetch('chapters/narrative.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null);
        } catch (e) { narrative = null; }
        if (!narrative || narrative.enabled === false) return; // backend kill — no toggle, no blurbs

        injectToggle();
        const state = readState();
        writeState(state);

        const draft = !!narrative.draft;

        // era blurbs — attach to .era-divider elements (id="era-1"..."era-4")
        const eraMap = { 'era-1': 'i', 'era-2': 'ii', 'era-3': 'iii', 'era-4': 'iv', 'era-5': 'v' };
        for (const [domId, key] of Object.entries(eraMap)) {
            const div = document.getElementById(domId);
            if (div) renderEraBlurb(div, narrative.eras?.[key], draft);
        }

        // anchor blurbs — attach to .chapter[id="y..."]
        for (const [anchor, text] of Object.entries(narrative.anchors || {})) {
            const ch = document.getElementById(anchor);
            if (ch && ch.classList.contains('chapter')) renderAnchorBlurb(ch, text, draft);
        }
    }

    main();
})();
