// gallery/cinema.js
//
// "CINEMA" mode: plays every captured video back-to-back, full-screen,
// grouped by shared themes. Consumes the live data (gallery DOM + the
// DAG from dag.js) so newly ingested captures auto-appear in the
// play order without any manual list to maintain.

(function () {
    'use strict';

    // ---- mount the marquee button ----
    const intro = document.querySelector('.gallery-intro');
    if (!intro) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cinema-btn';
    btn.setAttribute('aria-label', 'Play all captures full-screen in cinema mode');
    btn.innerHTML = `
        <span class="cinema-btn-bulbs" aria-hidden="true"></span>
        <span class="cinema-btn-icon" aria-hidden="true">▶</span>
        <span class="cinema-btn-label">Cinema</span>
        <span class="cinema-btn-sub">play all · grouped by theme</span>
        <span class="cinema-btn-bulbs cinema-btn-bulbs-bottom" aria-hidden="true"></span>
    `;
    intro.appendChild(btn);

    btn.addEventListener('click', () => {
        const order = buildPlayOrder();
        if (!order.length) return;
        startCinema(order);
    });

    // ---- build play order from live data ----
    // Source of truth: the rendered gallery items (so we play what the reader can see).
    // Theme data: pulled from window.RECEIPTS_DAG (built at runtime by dag.js, includes
    // every capture's evidence_records[] → themes[]). New ingests show up automatically.
    function buildPlayOrder() {
        const items = Array.from(document.querySelectorAll('.gallery-item'));
        const dag = window.RECEIPTS_DAG;
        const themesByCapture = new Map();
        if (dag && dag.nodes) {
            const claimById = new Map();
            for (const n of dag.nodes) {
                if (n.type === 'claim') claimById.set(n.id, n);
            }
            for (const n of dag.nodes) {
                if (n.type !== 'capture') continue;
                const themes = new Set();
                for (const eid of (n.evidence_records || [])) {
                    const claim = claimById.get(`claim:${eid}`);
                    if (claim && claim.themes) for (const t of claim.themes) themes.add(t);
                }
                const captureId = n.id.replace(/^capture:/, '');
                themesByCapture.set(captureId, Array.from(themes).sort());
            }
        }

        // Build playable list with primary theme + video URL
        const entries = items.map((it) => {
            const id = it.dataset.captureId;
            const themes = themesByCapture.get(id) || [];
            const video = it.querySelector('video source')?.getAttribute('src') || it.querySelector('video')?.getAttribute('src');
            const handle = it.querySelector('.gallery-handle')?.textContent?.trim() || id;
            const posted = readPostedDate(it);
            return { id, themes, primary: themes[0] || 'unsorted', video, handle, posted };
        }).filter((e) => e.video);

        // Order: count theme frequency across all captures, then sort each capture's themes
        // by global frequency desc so its "primary" is its most-shared theme.
        const themeFreq = new Map();
        for (const e of entries) for (const t of e.themes) themeFreq.set(t, (themeFreq.get(t) || 0) + 1);
        for (const e of entries) {
            e.themes.sort((a, b) => (themeFreq.get(b) || 0) - (themeFreq.get(a) || 0) || a.localeCompare(b));
            e.primary = e.themes[0] || 'unsorted';
        }

        // Group by primary theme, themes ordered by their global frequency desc.
        // Within a theme group, sort by posted date asc.
        const themeOrder = [...new Set(entries.map((e) => e.primary))]
            .sort((a, b) => (themeFreq.get(b) || 0) - (themeFreq.get(a) || 0) || a.localeCompare(b));
        const grouped = [];
        for (const t of themeOrder) {
            const group = entries.filter((e) => e.primary === t);
            group.sort((a, b) => (a.posted || '').localeCompare(b.posted || ''));
            for (const e of group) grouped.push(e);
        }
        return grouped;
    }

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

    // ---- cinema overlay + playback ----
    let overlay = null;
    let video = null;
    let order = [];
    let idx = 0;

    function startCinema(playOrder) {
        order = playOrder;
        idx = 0;
        buildOverlay();
        // try real Fullscreen API; if it fails (some browsers block on autoplay), fall back to fixed overlay only
        const target = document.documentElement;
        if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
        document.body.classList.add('cinema-on');
        playAt(0);
    }

    function buildOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'cinema-overlay';
        overlay.innerHTML = `
            <video class="cinema-video" playsinline autoplay></video>
            <div class="cinema-chrome">
                <button class="cinema-exit" type="button" aria-label="Exit cinema">✕</button>
                <div class="cinema-meta">
                    <span class="cinema-handle"></span>
                    <span class="cinema-theme"></span>
                    <span class="cinema-counter"></span>
                </div>
                <div class="cinema-controls">
                    <button class="cinema-prev" type="button" aria-label="Previous">◀ prev</button>
                    <button class="cinema-next" type="button" aria-label="Next">next ▶</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        video = overlay.querySelector('video');
        video.addEventListener('ended', () => playAt(idx + 1));
        video.addEventListener('error', () => playAt(idx + 1));
        overlay.querySelector('.cinema-exit').addEventListener('click', exitCinema);
        overlay.querySelector('.cinema-prev').addEventListener('click', () => playAt(idx - 1));
        overlay.querySelector('.cinema-next').addEventListener('click', () => playAt(idx + 1));
        document.addEventListener('keydown', cinemaKey);
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && overlay) exitCinema();
        });
    }

    function playAt(i) {
        if (i < 0 || i >= order.length) {
            exitCinema();
            return;
        }
        idx = i;
        const cur = order[idx];
        overlay.querySelector('.cinema-handle').textContent = cur.handle;
        overlay.querySelector('.cinema-theme').textContent = cur.primary;
        overlay.querySelector('.cinema-counter').textContent = `${idx + 1} / ${order.length}`;
        video.src = cur.video;
        const p = video.play();
        if (p && p.catch) p.catch(() => {/* autoplay blocked; user can hit play */});
    }

    function exitCinema() {
        document.removeEventListener('keydown', cinemaKey);
        if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {} }
        if (overlay) { overlay.remove(); overlay = null; video = null; }
        document.body.classList.remove('cinema-on');
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }

    function cinemaKey(e) {
        if (e.key === 'Escape') exitCinema();
        else if (e.key === 'ArrowRight') playAt(idx + 1);
        else if (e.key === 'ArrowLeft') playAt(idx - 1);
        else if (e.key === ' ') {
            e.preventDefault();
            if (video.paused) video.play(); else video.pause();
        }
    }
})();
