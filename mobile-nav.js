// mobile-nav.js
//
// Mobile-only chapter + theme navigation. Activates at viewport <= 880px.
//
// Renders a fixed bottom pill showing the current active chapter
// ("1965 · Vietnam · the war"), tap-opens a bottom sheet with two tabs:
// Timeline (era-grouped chapter list) and Themes (filter chips).
//
// On desktop, the existing left rail + top theme bar handle navigation;
// this script is a no-op there.

(function () {
    'use strict';

    const mq = window.matchMedia('(max-width: 880px)');
    if (!mq.matches) return;

    // ---- build pill + sheet DOM ----
    const body = document.body;

    const pill = document.createElement('button');
    pill.className = 'mnav-pill';
    pill.type = 'button';
    pill.setAttribute('aria-label', 'Open chapter navigation');
    pill.innerHTML = `
        <span class="mnav-pill-prefix">// chapter</span>
        <span class="mnav-pill-label">Open file</span>
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
    sheet.setAttribute('aria-label', 'Timeline navigation');
    sheet.hidden = true;
    sheet.innerHTML = `
        <div class="mnav-sheet-handle" aria-hidden="true"></div>
        <div class="mnav-sheet-head">
            <div class="mnav-tabs" role="tablist">
                <button class="mnav-tab is-active" type="button" role="tab" data-tab="timeline" aria-selected="true">Timeline</button>
                <button class="mnav-tab" type="button" role="tab" data-tab="themes" aria-selected="false">Themes</button>
            </div>
            <button class="mnav-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="mnav-tab-panel is-active" data-panel="timeline"></div>
        <div class="mnav-tab-panel" data-panel="themes"></div>
    `;
    body.appendChild(sheet);

    // ---- populate Timeline tab ----
    const timelinePanel = sheet.querySelector('[data-panel="timeline"]');
    const sourceTimeline = document.querySelector('.timeline-list');
    if (sourceTimeline) {
        const clone = sourceTimeline.cloneNode(true);
        clone.id = 'mnav-timeline-list';
        clone.classList.add('mnav-timeline-list');
        timelinePanel.appendChild(clone);
    }

    // ---- populate Themes tab (deferred until theme-bar renders) ----
    const themesPanel = sheet.querySelector('[data-panel="themes"]');
    function syncThemes() {
        const themeInner = document.querySelector('.theme-bar-inner');
        if (!themeInner) return;
        themesPanel.innerHTML = '';
        const cloned = themeInner.cloneNode(true);
        cloned.classList.add('mnav-themes-inner');
        themesPanel.appendChild(cloned);
        // Forward chip clicks to the original buttons so existing themes.js stays the source of truth.
        themesPanel.querySelectorAll('[data-theme]').forEach((chip) => {
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                const t = chip.dataset.theme;
                const original = themeInner.querySelector(`[data-theme="${CSS.escape(t)}"]`);
                if (original) original.click();
                // close sheet after theme select for snappy filter feedback
                closeSheet();
            });
        });
        // Also forward "more" / "clear" buttons
        themesPanel.querySelectorAll('.theme-more, .theme-clear').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.preventDefault();
                const sel = b.classList.contains('theme-clear') ? '.theme-clear' : '.theme-more';
                const original = themeInner.querySelector(sel);
                if (original) original.click();
                // re-sync to pick up new chip set
                setTimeout(syncThemes, 50);
            });
        });
    }
    syncThemes();
    // Re-sync when the source theme bar mutates (themes.js re-renders chips on filter)
    const themeBar = document.querySelector('.theme-bar');
    if (themeBar) {
        new MutationObserver(() => syncThemes()).observe(themeBar, { childList: true, subtree: true });
    }

    // ---- open / close behavior ----
    function openSheet() {
        backdrop.hidden = false;
        sheet.hidden = false;
        // force reflow before adding class for transition
        requestAnimationFrame(() => {
            backdrop.classList.add('is-open');
            sheet.classList.add('is-open');
        });
        body.classList.add('mnav-locked');
        // ensure timeline tab is active by default + scroll active chapter into view
        const timelineTab = sheet.querySelector('.mnav-tab[data-tab="timeline"]');
        if (timelineTab && !timelineTab.classList.contains('is-active')) timelineTab.click();
        const activeInSheet = sheet.querySelector('.mnav-timeline-list a.is-active');
        if (activeInSheet) {
            setTimeout(() => activeInSheet.scrollIntoView({ block: 'center', behavior: 'instant' }), 280);
        }
    }
    function closeSheet() {
        backdrop.classList.remove('is-open');
        sheet.classList.remove('is-open');
        body.classList.remove('mnav-locked');
        // wait out the transition before hiding
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
    // Tap a chapter link in the sheet → close sheet
    timelinePanel.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-anchor]');
        if (a) {
            setTimeout(closeSheet, 50);
        }
    });

    // ---- tab switching ----
    sheet.querySelectorAll('.mnav-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const which = tab.dataset.tab;
            sheet.querySelectorAll('.mnav-tab').forEach((t) => {
                const on = t.dataset.tab === which;
                t.classList.toggle('is-active', on);
                t.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            sheet.querySelectorAll('.mnav-tab-panel').forEach((p) => {
                p.classList.toggle('is-active', p.dataset.panel === which);
            });
        });
    });

    // ---- active-chapter detection ----
    // The desktop timeline.js sets .is-active on rail links. Mirror that here for the pill label.
    function updatePill() {
        const active = document.querySelector('.timeline-list a.is-active');
        if (!active) return;
        const year = active.querySelector('.t-year')?.textContent?.trim() || '';
        // strip the year span text from the link contents to get the topic
        const fullText = active.textContent.trim();
        const topic = fullText.replace(year, '').trim();
        sheet.querySelectorAll('.mnav-timeline-list a').forEach((a) => {
            a.classList.toggle('is-active', a.dataset.anchor === active.dataset.anchor);
        });
        pill.querySelector('.mnav-pill-label').textContent = year ? `${year} · ${topic}` : topic;
    }
    // Watch the desktop rail for active-class changes (timeline.js owns that)
    const railContainer = document.querySelector('.timeline-list');
    if (railContainer) {
        new MutationObserver(updatePill).observe(railContainer, {
            attributes: true,
            subtree: true,
            attributeFilter: ['class'],
        });
        updatePill();
    }
})();
