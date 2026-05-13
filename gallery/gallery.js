(function () {
    'use strict';

    async function loadJSON(url) {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`${url} -> ${r.status}`);
        return r.json();
    }
    async function loadText(url) {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`${url} -> ${r.status}`);
        return r.text();
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    async function loadEvidenceForCapture(captureId, evidenceIds) {
        const out = [];
        for (const id of evidenceIds || []) {
            try {
                const rec = await loadJSON(`../sources/evidence/${id}.json`);
                out.push({ id: rec.id, anchor: rec.anchor, year: rec.year, claim: rec.claim });
            } catch (e) {
                out.push({ id, anchor: null, year: null, claim: null, error: String(e) });
            }
        }
        return out;
    }

    function renderTags(tags) {
        if (!tags || !tags.length) return '';
        return `<div class="gallery-tags">${tags.map(t => `<span class="gallery-tag">${esc(t)}</span>`).join('')}</div>`;
    }

    function renderEvidence(records) {
        if (!records.length) return '<p class="gallery-section-h">No evidence records linked.</p>';
        const items = records.map(r => {
            if (r.error) {
                return `<li><span style="color:var(--accent)">${esc(r.id)} — load failed</span></li>`;
            }
            return `<li><a href="../#${esc(r.anchor)}">${esc(r.id)}</a><span class="ev-anchor">→ ${esc(r.anchor || '')}</span></li>`;
        }).join('');
        return `<p class="gallery-section-h">Resulting evidence on the timeline</p><ol class="gallery-evidence">${items}</ol>`;
    }

    function renderMediaCell(meta) {
        const captureDir = `../sources/captures/${meta.id}`;
        const webm = `${captureDir}/reel.webm`;
        const poster = `${captureDir}/frames/f001.png`;
        return `<div class="gallery-item-media">
            <video controls preload="none" poster="${esc(poster)}" playsinline>
                <source src="${esc(webm)}" type="video/webm">
                Your browser cannot play this video. Download: <a href="${esc(webm)}">${esc(meta.id)}.webm</a>
            </video>
        </div>`;
    }

    function renderMetaList(meta) {
        const rows = [];
        const post = (k, v) => v && rows.push(`<dt>${k}</dt><dd>${v}</dd>`);
        post('platform', esc(meta.platform || ''));
        post('handle', meta.handle ? `<a class="gallery-handle" href="${esc(meta.url)}" target="_blank" rel="noopener">${esc(meta.handle)}</a>` : '');
        post('posted', esc(meta.posted_at || ''));
        if (meta.engagement) {
            const e = meta.engagement;
            const bits = [];
            if (e.likes != null) bits.push(`${e.likes.toLocaleString()} likes`);
            if (e.comments != null) bits.push(`${e.comments.toLocaleString()} comments`);
            if (bits.length) post('engagement', esc(bits.join(' · ')));
        }
        post('audio', esc(meta.audio_track_actual || meta.audio_track || meta.audio_track_advertised || meta.audio_track_advertised_by_platform || ''));
        return `<dl class="gallery-meta">${rows.join('')}</dl>`;
    }

    async function renderItem(captureId) {
        const captureDir = `../sources/captures/${captureId}`;
        const meta = await loadJSON(`${captureDir}/meta.json`);

        let transcript = '';
        try { transcript = await loadText(`${captureDir}/transcript.txt`); } catch (e) {}

        const evidenceRecs = await loadEvidenceForCapture(captureId, meta.evidence_records);

        const overlay = meta.video_overlay_text_persistent || meta.video_overlay_text_observed;
        const overlayHtml = overlay ? `<div class="gallery-overlay-text">overlay: ${esc(overlay)}</div>` : '';

        const notesParts = [];
        if (meta.audio_content_summary) notesParts.push(`<div class="gallery-notes"><strong>what the audio claims, and what's verified</strong>${esc(meta.audio_content_summary)}</div>`);
        if (meta.implied_frame) notesParts.push(`<div class="gallery-notes"><strong>the case it's making</strong>${esc(meta.implied_frame)}</div>`);

        const transcriptHtml = transcript ? `
            <button class="gallery-transcript-toggle" type="button" aria-expanded="false">▾ show transcript</button>
            <pre class="gallery-transcript">${esc(transcript)}</pre>
        ` : '';

        return `<article class="gallery-item" data-capture-id="${esc(captureId)}">
            ${renderMediaCell(meta)}
            <div class="gallery-item-body">
                <div class="gallery-item-head">
                    <span class="filemark">// FILE — ${esc(meta.id)}</span>
                    <a class="gallery-handle" href="${esc(meta.url)}" target="_blank" rel="noopener">${esc(meta.handle || '')}</a>
                </div>
                ${meta.caption ? `<p class="gallery-caption">${esc(meta.caption)}</p>` : ''}
                ${overlayHtml}
                ${renderMetaList(meta)}
                ${renderTags(meta.hashtags)}
                ${transcriptHtml}
                ${renderEvidence(evidenceRecs)}
                ${notesParts.join('')}
            </div>
        </article>`;
    }

    function wireTranscriptToggles(root) {
        root.querySelectorAll('.gallery-transcript-toggle').forEach((btn) => {
            const pre = btn.nextElementSibling;
            btn.addEventListener('click', () => {
                const open = pre.classList.toggle('is-open');
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                btn.textContent = open ? '▴ hide transcript' : '▾ show transcript';
            });
        });
    }

    async function main() {
        const list = document.getElementById('gallery-list');
        const empty = document.getElementById('gallery-empty');
        let manifest;
        try {
            manifest = await loadJSON('../sources/captures/manifest.json');
        } catch (e) {
            empty.textContent = 'Could not load gallery manifest.';
            return;
        }
        const ids = manifest.captures || [];
        if (!ids.length) {
            empty.textContent = 'No captures filed yet.';
            return;
        }
        empty.remove();
        for (const id of ids) {
            try {
                const html = await renderItem(id);
                const wrap = document.createElement('div');
                wrap.innerHTML = html;
                const node = wrap.firstElementChild;
                list.appendChild(node);
                wireTranscriptToggles(node);
            } catch (e) {
                const err = document.createElement('p');
                err.className = 'placeholder';
                err.textContent = `Could not load capture "${id}": ${e.message}`;
                list.appendChild(err);
            }
        }
    }

    main();
})();
