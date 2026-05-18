// gallery-nav.js
//
// Mobile-only chapter navigation for the gallery page. Mirrors the
// timeline's mobile-nav.js pattern: bottom pill showing the current
// capture, tap to open a bottom-sheet list of all captures, tap a
// capture to scroll to it. Reuses .mnav-* CSS so the visuals match.

(function () {
    'use strict';

    const mq = window.matchMedia('(max-width: 880px)');
    if (!mq.matches) return;

    const items = Array.from(document.querySelectorAll('.gallery-item'));
    if (!items.length) {
        // gallery hasn't rendered yet — wait for it
        const obs = new MutationObserver(() => {
            if (document.querySelectorAll('.gallery-item').length) {
                obs.disconnect();
                init();
            }
        });
        const list = document.querySelector('#gallery-list');
        if (list) obs.observe(list, { childList: true });
        return;
    }
    init();

    function init() {
        const body = document.body;

        // ---- pill ----
        const pill = document.createElement('button');
        pill.className = 'mnav-pill';
        pill.type = 'button';
        pill.setAttribute('aria-label', 'Open gallery navigation');
        pill.innerHTML = `
            <span class="mnav-pill-prefix">// capture</span>
            <span class="mnav-pill-label">Loading…</span>
            <span class="mnav-pill-caret" aria-hidden="true">▴</span>
        `;
        body.appendChild(pill);

        const backdrop = document.createElement('div');
        backdrop.className = 'mnav-backdrop';
        backdrop.hidden = true;
        body.appendChild(backdrop);

        const sheet = document.createElement('div');
        sheet.className = 'mnav-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-label', 'Gallery navigation');
        sheet.hidden = true;
        sheet.innerHTML = `
            <div class="mnav-sheet-handle" aria-hidden="true"></div>
            <div class="mnav-sheet-head">
                <div class="mnav-tabs" role="tablist">
                    <button class="mnav-tab is-active" type="button" role="tab" data-tab="captures" aria-selected="true">Captures</button>
                </div>
                <button class="mnav-close" type="button" aria-label="Close">✕</button>
            </div>
            <div class="mnav-tab-panel is-active mnav-gallery-list" data-panel="captures"></div>
        `;
        body.appendChild(sheet);

        const listPanel = sheet.querySelector('[data-panel="captures"]');

        // ---- populate sheet from the rendered gallery items ----
        function buildList() {
            const fresh = Array.from(document.querySelectorAll('.gallery-item'));
            const html = fresh.map((it) => {
                const id = it.dataset.captureId || '';
                const handle = it.querySelector('.gallery-handle')?.textContent?.trim() || id;
                const posted = readPostedDate(it);
                return `<a href="#capture-${esc(id)}" data-capture="${esc(id)}">
                    <span class="mnav-cap-handle">${esc(handle)}</span>
                    <span class="mnav-cap-date">${esc(posted)}</span>
                </a>`;
            }).join('');
            listPanel.innerHTML = html;
        }
        function esc(s) {
            return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        // Find the <dd> whose preceding <dt> is "posted" — the meta dl order isn't fixed.
        function readPostedDate(item) {
            const dl = item.querySelector('.gallery-meta');
            if (!dl) return '';
            for (const dt of dl.querySelectorAll('dt')) {
                if (dt.textContent.trim().toLowerCase() === 'posted') {
                    return dt.nextElementSibling?.textContent?.trim() || '';
                }
            }
            return '';
        }

        // Make each gallery-item targetable via #capture-<id>
        function ensureIds() {
            document.querySelectorAll('.gallery-item').forEach((it) => {
                const id = it.dataset.captureId;
                if (id && !it.id) it.id = `capture-${id}`;
            });
        }

        ensureIds();
        buildList();

        // ---- open / close ----
        function openSheet() {
            backdrop.hidden = false;
            sheet.hidden = false;
            requestAnimationFrame(() => {
                backdrop.classList.add('is-open');
                sheet.classList.add('is-open');
            });
            body.classList.add('mnav-locked');
            // scroll active capture into view inside the sheet
            const activeInSheet = sheet.querySelector('a.is-active');
            if (activeInSheet) setTimeout(() => activeInSheet.scrollIntoView({ block: 'center' }), 280);
        }
        function closeSheet() {
            backdrop.classList.remove('is-open');
            sheet.classList.remove('is-open');
            body.classList.remove('mnav-locked');
            setTimeout(() => {
                if (!sheet.classList.contains('is-open')) {
                    backdrop.hidden = true;
                    sheet.hidden = true;
                }
            }, 250);
        }
        pill.addEventListener('click', openSheet);
        backdrop.addEventListener('click', closeSheet);
        sheet.querySelector('.mnav-close').addEventListener('click', closeSheet);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sheet.classList.contains('is-open')) closeSheet();
        });
        listPanel.addEventListener('click', (e) => {
            const a = e.target.closest('a[data-capture]');
            if (a) setTimeout(closeSheet, 50);
        });

        // ---- active-capture tracking ----
        let activeId = null;
        function setActive(id) {
            if (id === activeId) return;
            activeId = id;
            // update pill label
            const item = id ? document.getElementById(`capture-${id}`) : null;
            if (item) {
                const handle = item.querySelector('.gallery-handle')?.textContent?.trim() || id;
                const posted = readPostedDate(item);
                pill.querySelector('.mnav-pill-label').textContent = posted ? `${handle} · ${posted}` : handle;
            }
            // update active class in sheet list
            sheet.querySelectorAll('a[data-capture]').forEach((a) => {
                a.classList.toggle('is-active', a.dataset.capture === id);
            });
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible.length) setActive(visible[0].target.dataset.captureId);
            },
            { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
        );
        document.querySelectorAll('.gallery-item').forEach((it) => observer.observe(it));

        // Seed the pill label with the first item so it doesn't sit on "Loading…"
        // until the observer fires.
        const firstItem = document.querySelector('.gallery-item');
        if (firstItem && firstItem.dataset.captureId) {
            setActive(firstItem.dataset.captureId);
        }

        // Re-build list + observe when gallery adds more items (gallery.js loads them async)
        const galleryList = document.querySelector('#gallery-list');
        if (galleryList) {
            new MutationObserver(() => {
                ensureIds();
                buildList();
                document.querySelectorAll('.gallery-item').forEach((it) => observer.observe(it));
            }).observe(galleryList, { childList: true });
        }
    }
})();
