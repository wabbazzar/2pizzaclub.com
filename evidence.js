(function () {
    'use strict';

    async function loadJSON(url) {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
        return r.json();
    }

    function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function renderSource(src, idx) {
        const n = String(idx + 1).padStart(2, '0');
        const inner = src.url
            ? `<a href="${escapeHTML(src.url)}" rel="noopener" target="_blank">${escapeHTML(src.label)}</a>`
            : escapeHTML(src.label);
        const type = src.type ? `<span class="src-type">${escapeHTML(src.type)}</span>` : '';
        const quote = src.quote ? `<blockquote class="source-quote">${escapeHTML(src.quote)}</blockquote>` : '';
        const clip = src.clip
            ? `<figure class="source-clip"><a href="${escapeHTML(src.url || '')}" target="_blank" rel="noopener"><img src="sources/${escapeHTML(src.clip)}" alt="Highlighted excerpt from source" loading="lazy"></a></figure>`
            : '';
        return `<li data-n="${n}">${inner}${type}${quote}${clip}</li>`;
    }

    function renderCard(record) {
        const sources = (record.sources || []).map(renderSource).join('');
        return `
<div class="evidence-card" data-evidence-id="${escapeHTML(record.id)}">
  <p class="evidence-claim">${escapeHTML(record.claim)}</p>
  <ol class="evidence-sources">${sources}</ol>
</div>`.trim();
    }

    async function loadEvidence() {
        let manifest;
        try {
            manifest = await loadJSON('sources/evidence/manifest.json');
        } catch (e) {
            console.warn('[receipts] no evidence manifest yet:', e.message);
            return;
        }

        const byAnchor = new Map();
        for (const entry of manifest.records || []) {
            try {
                const rec = await loadJSON(`sources/evidence/${entry}`);
                const anchor = rec.anchor;
                if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
                byAnchor.get(anchor).push(rec);
            } catch (e) {
                console.warn('[receipts] could not load', entry, e.message);
            }
        }

        for (const [anchor, records] of byAnchor) {
            const slot = document.querySelector(`.evidence[data-anchor="${anchor}"]`);
            if (!slot) continue;
            const cards = records.map(renderCard).join('');
            slot.innerHTML = `<p class="evidence-head">Evidence</p>${cards}`;
        }
    }

    loadEvidence();
})();
