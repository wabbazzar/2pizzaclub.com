// receipts/dag.js
//
// Builds a directed acyclic graph from the existing JSON data at runtime.
// Exposes window.RECEIPTS_DAG = { nodes, edges, stats }; fires a `receipts:dag-ready` event.
//
// Node types:
//   capture  — a source piece (reel/clip/inspo) from receipts/sources/captures/
//   claim    — an evidence record from receipts/sources/evidence/
//   source   — one citation within a claim
//   anchor   — a chapter id on the timeline (y2001, y1975, ...)
//   era      — i/ii/iii/iv
//   theme    — keyword tag (cia, 9-11, mossad, ...)
//
// Edge kinds:
//   spawns       capture -> claim
//   cites        claim -> source
//   anchored-at  claim -> anchor
//   in-era       anchor -> era
//   tagged       claim -> theme
//
// Future viz (Sankey, force-directed, etc.) just consumes window.RECEIPTS_DAG.

(function () {
    'use strict';

    const fetchJSON = (url) => fetch(url, { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null).catch(() => null);

    async function build() {
        const evidenceManifest = await fetchJSON('/sources/evidence/manifest.json') || { records: [] };
        const capturesManifest = await fetchJSON('/sources/captures/manifest.json') || { captures: [] };

        const nodes = new Map(); // id -> node
        const edges = [];
        const addNode = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
        const addEdge = (from, to, kind) => edges.push({ from, to, kind });

        // captures + their evidence links
        for (const cid of capturesManifest.captures || []) {
            const meta = await fetchJSON(`/sources/captures/${cid}/meta.json`);
            if (!meta) continue;
            addNode({
                id: `capture:${cid}`,
                type: 'capture',
                label: meta.handle || cid,
                platform: meta.platform,
                handle: meta.handle,
                posted_at: meta.posted_at,
                caption: meta.caption,
                hashtags: meta.hashtags,
                evidence_records: meta.evidence_records || []
            });
            for (const eid of meta.evidence_records || []) {
                addEdge(`capture:${cid}`, `claim:${eid}`, 'spawns');
            }
        }

        // evidence records
        for (const fname of evidenceManifest.records || []) {
            const id = fname.replace(/\.json$/, '');
            const rec = await fetchJSON(`/sources/evidence/${fname}`);
            if (!rec) continue;
            addNode({
                id: `claim:${id}`,
                type: 'claim',
                label: rec.claim ? (rec.claim.slice(0, 90) + (rec.claim.length > 90 ? '…' : '')) : id,
                year: rec.year,
                era: rec.era,
                anchor: rec.anchor,
                themes: rec.themes || [],
                claim: rec.claim,
                status: rec.status
            });

            if (rec.anchor) {
                addNode({ id: `anchor:${rec.anchor}`, type: 'anchor', label: rec.anchor });
                addEdge(`claim:${id}`, `anchor:${rec.anchor}`, 'anchored-at');
                if (rec.era) {
                    addNode({ id: `era:${rec.era}`, type: 'era', label: 'era ' + rec.era.toUpperCase() });
                    addEdge(`anchor:${rec.anchor}`, `era:${rec.era}`, 'in-era');
                }
            }

            for (const t of (rec.themes || [])) {
                addNode({ id: `theme:${t}`, type: 'theme', label: t });
                addEdge(`claim:${id}`, `theme:${t}`, 'tagged');
            }

            for (let i = 0; i < (rec.sources || []).length; i++) {
                const s = rec.sources[i];
                const sid = `source:${id}-${i}`;
                addNode({
                    id: sid,
                    type: 'source',
                    label: s.label ? (s.label.slice(0, 70) + (s.label.length > 70 ? '…' : '')) : sid,
                    sourceType: s.type,
                    url: s.url,
                    quote: s.quote,
                    clip: s.clip,
                    clip_status: s.clip_status
                });
                addEdge(`claim:${id}`, sid, 'cites');
            }
        }

        // stats
        const byType = {};
        for (const n of nodes.values()) byType[n.type] = (byType[n.type] || 0) + 1;
        const byKind = {};
        for (const e of edges) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
        const clipCount = Array.from(nodes.values()).filter((n) => n.type === 'source' && n.clip).length;

        const dag = {
            nodes: Array.from(nodes.values()),
            edges,
            stats: {
                node_count: nodes.size,
                edge_count: edges.length,
                by_type: byType,
                by_kind: byKind,
                clip_count: clipCount
            }
        };
        window.RECEIPTS_DAG = dag;
        document.dispatchEvent(new CustomEvent('receipts:dag-ready', { detail: dag }));
        return dag;
    }

    build();
})();
