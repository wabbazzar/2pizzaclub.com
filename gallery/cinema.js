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
        await launchCinema();
    });

    async function launchCinema(startCaptureId) {
        if (!dagReady) {
            btn.classList.add('cinema-btn-loading');
            await Promise.race([
                new Promise((resolve) => document.addEventListener('receipts:dag-ready', resolve, { once: true })),
                new Promise((resolve) => setTimeout(resolve, 8000))
            ]);
            btn.classList.remove('cinema-btn-loading');
        }
        const order = buildPlayOrder();
        if (!order.length) return;
        let startIdx = 0;
        if (startCaptureId) {
            const found = order.findIndex((e) => e.id === startCaptureId);
            if (found >= 0) startIdx = found;
        }
        startCinema(order, startIdx);
    }

    // ---- deep-link auto-launch: ?cinema=1 starts at the first item,
    //                             ?cinema=<capture-id> starts at that capture.
    //
    // Waits for BOTH the DAG (themes) and the gallery DOM to be fully populated
    // — the gallery renders items one-by-one with intermediate fetches, so we
    // poll until the item count stops growing for 600ms before launching.
    // Otherwise we'd build a play order from a partial DOM and miss recent reels.
    const cinemaParam = new URLSearchParams(window.location.search).get('cinema');
    if (cinemaParam) {
        let lastCount = -1, stableSince = performance.now();
        const STABLE_MS = 600;
        const TIMEOUT_MS = 15000;
        const startedAt = performance.now();
        const startWhenReady = () => {
            const now = performance.now();
            const count = document.querySelectorAll('.gallery-item').length;
            if (count !== lastCount) { lastCount = count; stableSince = now; }
            const stable = count > 0 && (now - stableSince) >= STABLE_MS;
            const timedOut = (now - startedAt) >= TIMEOUT_MS;
            if (stable || (timedOut && count > 0)) {
                launchCinema(cinemaParam !== '1' ? cinemaParam : null);
            } else {
                setTimeout(startWhenReady, 150);
            }
        };
        setTimeout(startWhenReady, 100);
    }

    // ---- build play order from live data ----
    // Source of truth: the rendered gallery items (so we play what the reader can see).
    // Theme data: pulled from window.RECEIPTS_DAG (built at runtime by dag.js, includes
    // every capture's evidence_records[] → themes[]). New ingests show up automatically.
    //
    // Ordering strategy: greedy chain by theme overlap. Start with the capture whose
    // primary theme has the largest group, then at each step pick the unplayed capture
    // with the largest shared-themes set with the just-played one (Jaccard-style tie-break
    // by posted date). This yields smooth thematic transitions instead of hard cuts.
    // Defensive: cinema groups by subject, not by record state. If a meta-tag
    // (record-state signal like 'contested' or vacuous like 'evidence') ever
    // sneaks into a record's themes[] array, drop it here so it can't drive
    // grouping. Source-of-truth for the project taxonomy is sources/SCHEMA.md;
    // the rule for inclusion in this set is: would this tag tell a viewer what
    // the reel is ABOUT? If no, it's meta — strip it.
    const META_TAGS = new Set(['contested', 'evidence', 'alt-theory', 'documents']);

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
                    if (claim && claim.themes) {
                        for (const t of claim.themes) {
                            if (!META_TAGS.has(t)) themes.add(t);
                        }
                    }
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
    // Web Audio chain deliberately removed.
    //
    // Earlier versions of this file ran the cinema <video> through a DynamicsCompressor +
    // high-shelf + WaveShaper to "tame" peak clipping. Quantitative A/B on five of the
    // hottest captures (DYKm84QhHM6, DSvKzhhFCTr, DYaHLXji1vS, DWyiPW5jM0b, DWxV_gPD_DH)
    // showed the chain was *introducing* the artifact it was meant to fix — harsh
    // sample-to-sample jumps went from 1-11 on bypass to 32-96 through the chain, and
    // longest flat-runs (the square-wave signature of clipping) more than doubled. The
    // waveshaper's tanh saturation was manufacturing flat-tops at its own knee.
    //
    // The webm files are loudnorm-normalized at ingest (-16 LUFS / -1.5 dBTP), so default
    // <video> playback is already clean. Don't add processing the data says hurts.
    function ensureAudioChain() { /* no-op — see comment above */ }

    function startCinema(playOrder, startIdx) {
        order = playOrder;
        idx = startIdx || 0;
        buildOverlay();
        // try real Fullscreen API; if it fails (some browsers block on autoplay), fall back to fixed overlay only
        const target = document.documentElement;
        if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
        document.body.classList.add('cinema-on');
        playAt(idx);
    }

    function buildOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'cinema-overlay';
        overlay.innerHTML = `
            <video class="cinema-video" playsinline autoplay></video>
            <div class="cinema-speed-indicator" aria-hidden="true"></div>
            <div class="cinema-chrome">
                <button class="cinema-exit" type="button" aria-label="Exit cinema">✕</button>
                <button class="cinema-share" type="button" aria-label="Copy a direct link to this cinema clip">🔗 share</button>
                <div class="cinema-meta">
                    <span class="cinema-handle"></span>
                    <span class="cinema-theme"></span>
                    <span class="cinema-counter"></span>
                </div>
                <div class="cinema-controls">
                    <button class="cinema-prev" type="button" aria-label="Previous">◀ prev</button>
                    <button class="cinema-next" type="button" aria-label="Next">next ▶</button>
                </div>
                <button class="cinema-play" type="button" aria-label="Play / pause">⏸</button>
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
        overlay.querySelector('.cinema-share').addEventListener('click', shareCurrent);
        const playBtn = overlay.querySelector('.cinema-play');
        playBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
        const syncPlayBtn = () => { playBtn.textContent = video.paused ? '▶' : '⏸'; };
        video.addEventListener('play',  syncPlayBtn);
        video.addEventListener('pause', syncPlayBtn);
        syncPlayBtn();
        document.addEventListener('keydown', cinemaKey);
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && overlay) exitCinema();
        });
        wireGestures();
    }

    // ---- gestures: tap = toggle chrome, press-hold = 2x FF, hold+swipe-down = lock FF ----
    const FF_SPEED = 2;
    const HOLD_MS = 220;      // ms before hold-FF kicks in (separates tap from hold)
    const LOCK_SWIPE_PX = 35; // swipe-down distance to lock FF
    let chromeHidden = false;
    let ffActive = false;     // currently fast-forwarding via active press
    let ffLocked = false;     // FF locked-on by swipe-down
    let holdTimer = null;
    let holdStartY = 0;
    let pointerDownAt = 0;
    let pointerDownPos = { x: 0, y: 0 };

    function wireGestures() {
        // Only attach to the video. Controls (.cinema-chrome > *) sit above and handle their own clicks.
        video.addEventListener('pointerdown', onPointerDown);
        video.addEventListener('pointermove', onPointerMove);
        video.addEventListener('pointerup', onPointerUp);
        video.addEventListener('pointercancel', cancelHold);
        // Prevent the native double-tap-to-zoom + context menu so gestures stay clean
        video.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        pointerDownAt = performance.now();
        pointerDownPos = { x: e.clientX, y: e.clientY };
        holdStartY = e.clientY;
        try { video.setPointerCapture(e.pointerId); } catch (_) {}
        holdTimer = setTimeout(() => {
            // long-hold reached: start FF (unless already locked)
            if (!ffLocked) {
                ffActive = true;
                video.playbackRate = FF_SPEED;
                showSpeedIndicator(`${FF_SPEED}x`, 'hold');
            }
        }, HOLD_MS);
    }

    function onPointerMove(e) {
        if (!ffActive || ffLocked) return;
        const dy = e.clientY - holdStartY;
        if (dy >= LOCK_SWIPE_PX) {
            ffLocked = true;
            // lock takes over from active-press; clear ffActive so a subsequent tap
            // hits the unlock branch instead of the "release-ends-FF" branch.
            ffActive = false;
            showSpeedIndicator(`${FF_SPEED}x · locked`, 'lock');
        }
    }

    function onPointerUp(e) {
        const dt = performance.now() - pointerDownAt;
        const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        clearTimeout(holdTimer); holdTimer = null;
        try { video.releasePointerCapture(e.pointerId); } catch (_) {}

        const wasFF = ffActive;
        // If FF was active (long hold) and we're NOT locked, releasing ends FF.
        if (wasFF && !ffLocked) {
            ffActive = false;
            video.playbackRate = 1;
            hideSpeedIndicator();
        }

        // A "tap" is a short release that didn't drag much and didn't trigger long-hold FF.
        if (!wasFF && dt < HOLD_MS && moved < 12) {
            if (ffLocked) {
                // tap while FF-locked = unlock + reset speed
                ffLocked = false;
                video.playbackRate = 1;
                hideSpeedIndicator();
            } else {
                // plain tap: toggle chrome visibility
                toggleChrome();
            }
        }
    }

    function togglePlay() {
        if (!video) return;
        if (video.paused) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
    }

    function cancelHold() {
        clearTimeout(holdTimer); holdTimer = null;
        if (ffActive && !ffLocked) {
            ffActive = false;
            video.playbackRate = 1;
            hideSpeedIndicator();
        }
    }

    function toggleChrome() {
        chromeHidden = !chromeHidden;
        overlay.classList.toggle('chrome-hidden', chromeHidden);
    }

    function showSpeedIndicator(text, variant) {
        const el = overlay.querySelector('.cinema-speed-indicator');
        if (!el) return;
        el.textContent = text;
        el.dataset.variant = variant;
        el.classList.add('on');
    }
    function hideSpeedIndicator() {
        const el = overlay.querySelector('.cinema-speed-indicator');
        if (!el) return;
        el.classList.remove('on');
    }

    // ---- shareable deep link ----
    function shareCurrent() {
        const cur = order[idx];
        if (!cur) return;
        const url = new URL(window.location.href);
        url.search = ''; url.hash = '';
        url.searchParams.set('cinema', cur.id);
        const link = url.toString();
        const finish = (msg) => {
            const btn = overlay.querySelector('.cinema-share');
            if (!btn) return;
            const orig = btn.textContent;
            btn.textContent = msg;
            setTimeout(() => { btn.textContent = orig; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(() => finish('✓ link copied'), () => finish('copy failed'));
        } else {
            // fallback: legacy execCommand path
            const ta = document.createElement('textarea');
            ta.value = link; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); finish('✓ link copied'); } catch (_) { finish('copy failed'); }
            ta.remove();
        }
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
        // honor an FF-lock across reel transitions; otherwise normal speed
        video.playbackRate = ffLocked ? FF_SPEED : 1;
        const p = video.play();
        if (p && p.catch) p.catch(() => {/* autoplay blocked; user can hit play */});
    }

    function exitCinema() {
        document.removeEventListener('keydown', cinemaKey);
        clearTimeout(holdTimer); holdTimer = null;
        ffActive = false; ffLocked = false; chromeHidden = false;
        if (video) { try { video.pause(); video.playbackRate = 1; video.removeAttribute('src'); video.load(); } catch (e) {} }
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
