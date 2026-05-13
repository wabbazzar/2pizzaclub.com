// receipts/themes.js
//
// Theme-chip filter + see-also lateral links.
//
// On `receipts:dag-ready`:
//   1. Computes theme counts from the DAG and renders a chip strip into #theme-bar.
//   2. Annotates every .evidence-card with data-themes from its claim node.
//   3. Appends a "see also" footer to each card with up to 3 related records
//      (records that share at least one theme with the current card).
//   4. Resolves filter state from ?theme=… URL param, then localStorage, then empty.
//   5. Toggling a chip updates state, URL, localStorage, and re-applies the filter.
//
// Filter semantics: OR. A card matches if it shares >=1 theme with any active chip.
// When no chips are active, everything is visible.
// Cards that don't match get .filter-hidden. Chapters and rail entries with zero
// visible cards collapse via the same class.

(function () {
    'use strict';

    const STORAGE_KEY = 'receipts.themes';
    const TOP_N = 8;

    let activeThemes = new Set();
    let claimsById = new Map();   // claim-id (without 'claim:' prefix) -> { themes, anchor, label }
    let recordsByTheme = new Map(); // theme -> Set<claim-id>

    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function buildIndex(dag) {
        for (const n of dag.nodes) {
            if (n.type === 'claim') {
                const id = n.id.replace(/^claim:/, '');
                const themes = n.themes || [];
                const label = (n.claim || '').slice(0, 60).trim();
                claimsById.set(id, { themes, anchor: n.anchor, label });
                for (const t of themes) {
                    if (!recordsByTheme.has(t)) recordsByTheme.set(t, new Set());
                    recordsByTheme.get(t).add(id);
                }
            }
        }
    }

    function themeCounts() {
        const arr = [];
        for (const [t, set] of recordsByTheme) arr.push([t, set.size]);
        arr.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        return arr;
    }

    function renderChipBar() {
        const bar = document.getElementById('theme-bar');
        if (!bar) return;
        const all = themeCounts();
        const top = all.slice(0, TOP_N);
        const rest = all.slice(TOP_N);

        const chipsHtml = top.map(([t, n]) => chipHtml(t, n)).join('');
        const moreHtml = rest.length
            ? `<button class="theme-more" type="button" aria-expanded="false">more (${rest.length})</button>
               <div class="theme-overflow" hidden>${rest.map(([t, n]) => chipHtml(t, n)).join('')}</div>`
            : '';

        bar.innerHTML = `
            <div class="theme-bar-inner">
                <span class="theme-label">// THEMES</span>
                <div class="theme-chips">${chipsHtml}${moreHtml}</div>
                <button class="theme-clear" type="button" hidden>clear filters</button>
                <span class="theme-count" aria-live="polite"></span>
            </div>`;

        // wire chips
        bar.querySelectorAll('.theme-chip').forEach((el) => {
            el.addEventListener('click', () => toggleTheme(el.dataset.theme));
        });
        const moreBtn = bar.querySelector('.theme-more');
        if (moreBtn) {
            moreBtn.addEventListener('click', () => {
                const ov = bar.querySelector('.theme-overflow');
                const open = ov.hasAttribute('hidden');
                if (open) { ov.removeAttribute('hidden'); moreBtn.setAttribute('aria-expanded', 'true'); moreBtn.textContent = `less`; }
                else { ov.setAttribute('hidden', ''); moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.textContent = `more (${rest.length})`; }
            });
        }
        bar.querySelector('.theme-clear').addEventListener('click', () => {
            activeThemes.clear();
            writeState();
            applyFilter();
            updateChipStates();
        });
    }

    function chipHtml(t, n) {
        return `<button class="theme-chip" type="button" data-theme="${esc(t)}" aria-pressed="false">${esc(t)} · ${n}</button>`;
    }

    function annotateCards() {
        for (const card of document.querySelectorAll('.evidence-card')) {
            const id = card.dataset.evidenceId;
            const meta = claimsById.get(id);
            if (!meta) continue;
            card.dataset.themes = (meta.themes || []).join(',');
        }
    }

    function appendSeeAlso() {
        // Build adjacency: for each card on page, find records that share >=1 theme.
        // Rank by overlap count desc; pick top 3.
        for (const card of document.querySelectorAll('.evidence-card')) {
            if (card.querySelector('.see-also')) continue; // idempotent
            const id = card.dataset.evidenceId;
            const meta = claimsById.get(id);
            if (!meta || !meta.themes.length) continue;
            const overlap = new Map(); // other-id -> count
            for (const t of meta.themes) {
                const set = recordsByTheme.get(t);
                if (!set) continue;
                for (const other of set) {
                    if (other === id) continue;
                    overlap.set(other, (overlap.get(other) || 0) + 1);
                }
            }
            const ranked = [...overlap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
            if (!ranked.length) continue;
            const links = ranked.map(([otherId]) => {
                const other = claimsById.get(otherId);
                const anchor = other?.anchor || '';
                const labelShort = (other?.label || otherId).replace(/\s+/g, ' ');
                return `<a href="#${esc(anchor)}" data-jump-to="${esc(otherId)}">${esc(otherId)}</a>`;
            }).join('');
            const div = document.createElement('div');
            div.className = 'see-also';
            div.innerHTML = `<span class="see-also-label">see also</span> ${links}`;
            card.appendChild(div);
        }

        // intercept see-also clicks to also highlight the target card briefly
        document.querySelectorAll('.see-also a[data-jump-to]').forEach((a) => {
            a.addEventListener('click', () => {
                const tid = a.dataset.jumpTo;
                setTimeout(() => {
                    const t = document.querySelector(`.evidence-card[data-evidence-id="${tid}"]`);
                    if (!t) return;
                    t.classList.add('jump-highlight');
                    setTimeout(() => t.classList.remove('jump-highlight'), 1600);
                }, 150);
            });
        });
    }

    function readState() {
        const url = new URL(window.location.href);
        const fromUrl = url.searchParams.get('theme');
        if (fromUrl != null) {
            const list = fromUrl.split(',').map((s) => s.trim()).filter(Boolean);
            activeThemes = new Set(list);
            localStorage.setItem(STORAGE_KEY, [...activeThemes].join(','));
            return;
        }
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) activeThemes = new Set(stored.split(',').map((s) => s.trim()).filter(Boolean));
    }

    function writeState() {
        const list = [...activeThemes].sort();
        localStorage.setItem(STORAGE_KEY, list.join(','));
        const url = new URL(window.location.href);
        if (list.length) url.searchParams.set('theme', list.join(','));
        else url.searchParams.delete('theme');
        window.history.replaceState({}, '', url.toString());
    }

    function toggleTheme(t) {
        if (activeThemes.has(t)) activeThemes.delete(t);
        else activeThemes.add(t);
        writeState();
        applyFilter();
        updateChipStates();
    }

    function updateChipStates() {
        document.querySelectorAll('.theme-chip').forEach((el) => {
            const on = activeThemes.has(el.dataset.theme);
            el.setAttribute('aria-pressed', on ? 'true' : 'false');
            el.classList.toggle('is-active', on);
        });
        const bar = document.getElementById('theme-bar');
        if (bar) {
            bar.querySelector('.theme-clear').hidden = activeThemes.size === 0;
        }
    }

    function applyFilter() {
        const themes = activeThemes;
        const allCards = document.querySelectorAll('.evidence-card');
        let shown = 0, total = allCards.length;

        for (const card of allCards) {
            const cardThemes = (card.dataset.themes || '').split(',').filter(Boolean);
            const match = themes.size === 0 || cardThemes.some((t) => themes.has(t));
            card.classList.toggle('filter-hidden', !match);
            if (match) shown++;
        }

        // hide chapters whose cards are all filter-hidden
        for (const ch of document.querySelectorAll('.chapter')) {
            const cards = ch.querySelectorAll('.evidence-card');
            if (cards.length === 0) {
                // chapter has no records at all — show only when filter is empty
                ch.classList.toggle('filter-hidden', themes.size > 0);
                continue;
            }
            const anyVisible = Array.from(cards).some((c) => !c.classList.contains('filter-hidden'));
            ch.classList.toggle('filter-hidden', !anyVisible);
        }

        // dim era dividers with no visible chapters
        for (const era of document.querySelectorAll('.era-divider')) {
            const allChapters = [];
            let n = era.nextElementSibling;
            while (n && !n.classList.contains('era-divider')) {
                if (n.classList.contains('chapter')) allChapters.push(n);
                n = n.nextElementSibling;
            }
            const anyVisible = allChapters.some((c) => !c.classList.contains('filter-hidden'));
            era.classList.toggle('filter-hidden', !anyVisible && themes.size > 0 && allChapters.length > 0);
        }

        // dim rail entries whose anchor has no visible cards
        for (const a of document.querySelectorAll('.timeline-list a[data-anchor]')) {
            const anchor = a.dataset.anchor;
            const slot = document.querySelector(`.evidence[data-anchor="${anchor}"]`);
            let anyVisible = true;
            if (themes.size > 0) {
                if (!slot) anyVisible = false;
                else {
                    const cs = slot.querySelectorAll('.evidence-card');
                    anyVisible = cs.length > 0 && Array.from(cs).some((c) => !c.classList.contains('filter-hidden'));
                }
            }
            a.classList.toggle('filter-dim', !anyVisible);
        }

        // counter
        const count = document.querySelector('.theme-count');
        if (count) {
            if (themes.size === 0) count.textContent = '';
            else count.textContent = `showing ${shown} of ${total}`;
        }
    }

    function init() {
        const dag = window.RECEIPTS_DAG;
        if (!dag) return;
        buildIndex(dag);
        renderChipBar();
        annotateCards();
        appendSeeAlso();
        readState();
        applyFilter();
        updateChipStates();
    }

    if (window.RECEIPTS_DAG) init();
    document.addEventListener('receipts:dag-ready', init);
})();
