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

    // DAG-readiness gate: dag.js fires `receipts:dag-ready` after every evidence
    // record is fetched. Until then, buildPlayOrder() has no themes and we'd
    // bucket everything as 'unsorted'.
    let dagReady = !!(window.RECEIPTS_DAG && window.RECEIPTS_DAG.nodes && window.RECEIPTS_DAG.nodes.some((n) => n.type === 'claim'));
    document.addEventListener('receipts:dag-ready', () => { dagReady = true; btn.classList.remove('cinema-btn-loading'); });
    if (!dagReady) btn.classList.add('cinema-btn-loading');

    btn.addEventListener('click', async () => {
        if (!dagReady) {
            // wait up to 8s for the DAG to finish loading; if it never does, fall back to ungrouped play.
            btn.classList.add('cinema-btn-loading');
            await Promise.race([
                new Promise((resolve) => document.addEventListener('receipts:dag-ready', resolve, { once: true })),
                new Promise((resolve) => setTimeout(resolve, 8000))
            ]);
            btn.classList.remove('cinema-btn-loading');
        }
        const order = buildPlayOrder();
        if (!order.length) return;
        startCinema(order);
    });

    // ---- build play order from live data ----
    // Source of truth: the rendered gallery items (so we play what the reader can see).
    // Theme data: pulled from window.RECEIPTS_DAG (built at runtime by dag.js, includes
    // every capture's evidence_records[] → themes[]). New ingests show up automatically.
    //
    // Ordering strategy: greedy chain by theme overlap. Start with the capture whose
    // primary theme has the largest group, then at each step pick the unplayed capture
    // with the largest shared-themes set with the just-played one (Jaccard-style tie-break
    // by posted date). This yields smooth thematic transitions instead of hard cuts.
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

        const entries = items.map((it) => {
            const id = it.dataset.captureId;
            const themes = themesByCapture.get(id) || [];
            const video = it.querySelector('video source')?.getAttribute('src') || it.querySelector('video')?.getAttribute('src');
            const handle = it.querySelector('.gallery-handle')?.textContent?.trim() || id;
            const posted = readPostedDate(it);
            return { id, themes, themeSet: new Set(themes), primary: themes[0] || 'unsorted', video, handle, posted };
        }).filter((e) => e.video);

        // Rank each capture's themes by global frequency (most-shared first).
        const themeFreq = new Map();
        for (const e of entries) for (const t of e.themes) themeFreq.set(t, (themeFreq.get(t) || 0) + 1);
        for (const e of entries) {
            e.themes.sort((a, b) => (themeFreq.get(b) || 0) - (themeFreq.get(a) || 0) || a.localeCompare(b));
            e.primary = e.themes[0] || 'unsorted';
        }

        // Seed: pick the entry whose primary theme has the largest cohort.
        // Tie-break: earliest posted date inside that cohort.
        const primaryCount = new Map();
        for (const e of entries) primaryCount.set(e.primary, (primaryCount.get(e.primary) || 0) + 1);
        const remaining = entries.slice();
        remaining.sort((a, b) => {
            const ca = primaryCount.get(a.primary) || 0, cb = primaryCount.get(b.primary) || 0;
            if (ca !== cb) return cb - ca;
            if (a.primary !== b.primary) return a.primary.localeCompare(b.primary);
            return (a.posted || '').localeCompare(b.posted || '');
        });

        const ordered = [];
        let cur = remaining.shift();
        ordered.push(cur);
        while (remaining.length) {
            // Score: shared theme count, then Jaccard ratio, then matching-primary boost,
            // then frequency of shared themes (rarer overlap counts more), then posted-date proximity.
            let bestIdx = 0, bestScore = -Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const cand = remaining[i];
                let shared = 0, sharedFreq = 0;
                for (const t of cand.themeSet) if (cur.themeSet.has(t)) { shared++; sharedFreq += 1 / Math.max(1, themeFreq.get(t) || 1); }
                const union = new Set([...cur.themeSet, ...cand.themeSet]).size || 1;
                const jaccard = shared / union;
                const primaryBoost = (cand.primary === cur.primary) ? 0.5 : 0;
                const score = shared * 100 + jaccard * 20 + primaryBoost + sharedFreq;
                if (score > bestScore) { bestScore = score; bestIdx = i; }
            }
            cur = remaining.splice(bestIdx, 1)[0];
            ordered.push(cur);
        }

        return ordered;
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
    let audioCtx = null;       // single AudioContext reused across captures
    let audioSourceNode = null;// MediaElementSource for the cinema <video>
    let audioCompressor = null;
    let audioGain = null;

    // Web Audio chain: video -> DynamicsCompressor -> Gain -> destination.
    // Tames the harsh peaks the user reported (the Instagram captures' opus track
    // is hot enough that loud moments clip on consumer speakers).
    function ensureAudioChain() {
        if (audioCtx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
            audioSourceNode = audioCtx.createMediaElementSource(video);
            audioCompressor = audioCtx.createDynamicsCompressor();
            // Aggressive but musical: knee at -22dB, fast attack, slow release.
            audioCompressor.threshold.setValueAtTime(-22, audioCtx.currentTime);
            audioCompressor.knee.setValueAtTime(24, audioCtx.currentTime);
            audioCompressor.ratio.setValueAtTime(8, audioCtx.currentTime);
            audioCompressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
            audioCompressor.release.setValueAtTime(0.25, audioCtx.currentTime);
            audioGain = audioCtx.createGain();
            audioGain.gain.setValueAtTime(0.85, audioCtx.currentTime);
            audioSourceNode.connect(audioCompressor);
            audioCompressor.connect(audioGain);
            audioGain.connect(audioCtx.destination);
        } catch (_) { /* if Web Audio is unavailable, fall back to default playback */ }
    }

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
        ensureAudioChain();
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
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
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
