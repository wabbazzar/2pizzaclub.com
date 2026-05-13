// receipts/tools/clip-evidence.mjs
//
// Open each source URL in an evidence record, find the `quote` text on the page,
// inject a yellow highlight, screenshot a cropped region centered on the quote,
// save the image to receipts/sources/clips/<evidence-id>-<n>.png, and write back
// a `clip` reference into the record.
//
// Run with the dev-browser plugin's playwright install:
//   cd /home/wabbazzar/.claude/plugins/cache/dev-browser-marketplace/dev-browser/66682fb0513a/skills/dev-browser
//   node /home/wabbazzar/code/wabbazzar.github.io/receipts/tools/clip-evidence.mjs <evidence-id> [<id2> ...]
//
// Use --all to process every record listed in receipts/sources/evidence/manifest.json.

import { chromium } from "playwright";
import * as fs from "node:fs";

const ROOT = "/home/wabbazzar/code/wabbazzar.github.io/receipts";
const EVIDENCE_DIR = `${ROOT}/sources/evidence`;
const CLIPS_DIR = `${ROOT}/sources/clips`;

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 4) + "\n"); }

// Function body passed AS A STRING to page.evaluate — bypasses any TS/esbuild
// __name() wrapping that would crash in the browser context.
const PAGE_HIGHLIGHTER = function (rawQuote) {
    const norm = function (s) {
        return s.toLowerCase()
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[–—]/g, "-")
            .replace(/ /g, " ")
            .replace(/\s+/g, " ");
    };
    const tryNeedle = function (needleNorm) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                const p = n.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                const tag = p.tagName.toLowerCase();
                if (tag === "script" || tag === "style" || tag === "noscript") return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            const raw = n.nodeValue || "";
            const i = norm(raw).indexOf(needleNorm);
            if (i < 0) continue;
            // approximate raw index from normalized index (works when whitespace ratios match)
            const before = raw.slice(0, i);
            const match = raw.slice(i, i + needleNorm.length);
            const after = raw.slice(i + needleNorm.length);
            const parent = n.parentNode;
            const mark = document.createElement("mark");
            mark.id = "__clip_target__";
            mark.style.cssText = "background: #fff200 !important; color: #000 !important; padding: 1px 0 !important; box-shadow: 0 2px 0 #c84630 !important; font-weight: inherit !important;";
            mark.appendChild(document.createTextNode(match));
            parent.insertBefore(document.createTextNode(before), n);
            parent.insertBefore(mark, n);
            parent.insertBefore(document.createTextNode(after), n);
            parent.removeChild(n);
            return mark;
        }
        return null;
    };
    // Cross-node fallback: build flat string of all visible text nodes,
    // find the match, build a Range spanning the matched nodes, wrap it.
    // Handles cases where the quote spans <a> tags or other inline elements
    // (very common on Wikipedia and other CMS pages).
    const tryCrossNode = function (needleNorm) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                const p = n.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                const tag = p.tagName.toLowerCase();
                if (tag === "script" || tag === "style" || tag === "noscript") return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const items = [];
        let flat = "";
        let n;
        while ((n = walker.nextNode())) {
            const raw = n.nodeValue || "";
            const normVal = norm(raw);
            items.push({ node: n, normStart: flat.length, normLen: normVal.length, rawLen: raw.length });
            flat += normVal;
        }
        const idx = flat.indexOf(needleNorm);
        if (idx < 0) return null;
        const endIdx = idx + needleNorm.length;
        let startItem = null, startOff = 0, endItem = null, endOff = 0;
        for (const it of items) {
            if (it.normStart <= idx && idx < it.normStart + it.normLen) {
                startItem = it; startOff = Math.min(it.rawLen, idx - it.normStart);
            }
            if (it.normStart < endIdx && endIdx <= it.normStart + it.normLen) {
                endItem = it; endOff = Math.min(it.rawLen, endIdx - it.normStart);
                break;
            }
        }
        if (!startItem || !endItem) return null;
        try {
            const range = document.createRange();
            range.setStart(startItem.node, startOff);
            range.setEnd(endItem.node, endOff);
            const mark = document.createElement("mark");
            mark.id = "__clip_target__";
            mark.style.cssText = "background: #fff200 !important; color: #000 !important; padding: 1px 0 !important; box-shadow: 0 2px 0 #c84630 !important; font-weight: inherit !important;";
            try { range.surroundContents(mark); }
            catch (_) {
                const frag = range.extractContents();
                mark.appendChild(frag);
                range.insertNode(mark);
            }
            return mark;
        } catch (_) { return null; }
    };

    let mark = tryNeedle(norm(rawQuote));
    let method = "exact";
    if (!mark) { mark = tryCrossNode(norm(rawQuote)); if (mark) method = "cross-node"; }
    if (!mark && rawQuote.length > 60) {
        mark = tryNeedle(norm(rawQuote.slice(0, 60)));
        if (mark) method = "head60";
        else { mark = tryCrossNode(norm(rawQuote.slice(0, 60))); if (mark) method = "cross-node60"; }
    }
    if (!mark && rawQuote.length > 30) {
        mark = tryNeedle(norm(rawQuote.slice(0, 30)));
        if (mark) method = "head30";
        else { mark = tryCrossNode(norm(rawQuote.slice(0, 30))); if (mark) method = "cross-node30"; }
    }
    if (!mark) return null;
    mark.scrollIntoView({ block: "center" });
    return { method };
};

async function clipOneSource(ctx, rec, idx) {
    const src = rec.sources[idx];
    if (!src.quote || !src.url) return null;

    const outFile = `${rec.id}-${String(idx).padStart(2, "0")}.png`;
    const outPath = `${CLIPS_DIR}/${outFile}`;

    const page = await ctx.newPage();
    try {
        const resp = await page.goto(src.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        const status = resp ? resp.status() : 0;
        if (status >= 400) { src.clip_status = `http-${status}`; await page.close(); return null; }

        await page.waitForTimeout(1500);

        // pass the highlighter as a string so tsx/esbuild can't rewrite it
        const found = await page.evaluate(PAGE_HIGHLIGHTER, src.quote);
        if (!found) { src.clip_status = "quote-not-found"; await page.close(); return null; }

        await page.waitForTimeout(400);

        const box = await page.$eval("#__clip_target__", (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width, h: r.height };
        });

        const viewport = page.viewportSize() || { width: 1280, height: 900 };
        const clipWidth = Math.min(900, viewport.width - 40);
        const padTop = 140;
        const padBottom = 180;
        const cx = box.x + box.w / 2;
        const clip = {
            x: Math.max(0, Math.min(viewport.width - clipWidth, cx - clipWidth / 2)),
            y: Math.max(0, box.y - padTop),
            width: clipWidth,
            height: Math.min(viewport.height, box.h + padTop + padBottom)
        };

        await page.screenshot({ path: outPath, clip });
        src.clip = `clips/${outFile}`;
        src.clip_status = `ok-${found.method}`;
        console.log(`  [${rec.id}-${idx}] -> ${outFile} (${found.method})`);
        await page.close();
        return outFile;
    } catch (e) {
        src.clip_status = `error: ${e.message.slice(0, 120)}`;
        console.warn(`  [${rec.id}-${idx}] error: ${e.message}`);
        try { await page.close(); } catch (_) { /* ignore */ }
        return null;
    }
}

async function processOne(ctx, id) {
    const recPath = `${EVIDENCE_DIR}/${id}.json`;
    if (!fs.existsSync(recPath)) { console.warn(`  missing: ${id}`); return; }
    const rec = readJSON(recPath);
    console.log(`==== ${id} ====`);
    let wrote = false;
    for (let i = 0; i < rec.sources.length; i++) {
        const result = await clipOneSource(ctx, rec, i);
        if (result || rec.sources[i].clip_status) wrote = true;
    }
    if (wrote) writeJSON(recPath, rec);
}

async function main() {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });

    const args = process.argv.slice(2);
    let ids;
    if (args.includes("--all")) {
        const manifest = readJSON(`${EVIDENCE_DIR}/manifest.json`);
        ids = manifest.records.map((f) => f.replace(/\.json$/, ""));
    } else {
        ids = args.filter((a) => !a.startsWith("--"));
    }
    if (ids.length === 0) {
        console.error("usage: clip-evidence.mjs <evidence-id> [<id2> ...]  OR  --all");
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        viewport: { width: 1200, height: 900 },
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    for (const id of ids) {
        await processOne(ctx, id);
    }

    await ctx.close();
    await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
