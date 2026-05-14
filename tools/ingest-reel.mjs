#!/usr/bin/env node
// receipts/tools/ingest-reel.mjs
//
// One-shot ingest of an Instagram reel into the receipts pipeline.
//
// Usage:
//   node receipts/tools/ingest-reel.mjs <SHORTCODE>           # full pipeline
//   node receipts/tools/ingest-reel.mjs <SHORTCODE> --skip-capture   # reuse existing reel.webm
//   node receipts/tools/ingest-reel.mjs <SHORTCODE> --skip-transcribe
//   node receipts/tools/ingest-reel.mjs <URL>                 # accepts full URL too
//
// Steps performed:
//   1. Playwright headless capture (MediaRecorder over <video>.captureStream())
//      - bypasses IG's auth-wall poster fallback because the <video> stream is real
//   2. og:* meta scrape — caption, handle, posted date, engagement
//   3. ffmpeg → audio (wav, mono 16k for whisper)
//   4. ffmpeg → frames at 0.5fps under frames/
//   5. whisper base.en → transcript.{txt,srt,vtt,json}
//   6. Write meta.json skeleton with everything we know so far + editorial slots to fill
//   7. Write transcript.txt with header + body + accuracy-note section
//   8. Add capture id to receipts/sources/captures/manifest.json
//
// What this DOES NOT do (left to editorial pass):
//   - decompose claims and write evidence records
//   - search for primary sources
//   - run clip-evidence.mjs (call separately once you've added `quote` fields)
//
// Dependencies (machine-local, see receipts/sources/SCHEMA.md):
//   - playwright (used via the dev-browser plugin's node_modules)
//   - ffmpeg + ffprobe in PATH
//   - whisper installed at /tmp/whisper-venv (`python3 -m venv /tmp/whisper-venv && /tmp/whisper-venv/bin/pip install openai-whisper`)
//
// Invoke from the dev-browser plugin dir for playwright resolution:
//   cd /home/wabbazzar/.claude/plugins/cache/dev-browser-marketplace/dev-browser/66682fb0513a/skills/dev-browser
//   node /home/wabbazzar/code/wabbazzar.github.io/receipts/tools/ingest-reel.mjs <SHORTCODE>

import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAPS_DIR = `${ROOT}/sources/captures`;
const WHISPER = "/tmp/whisper-venv/bin/whisper";

// ---------- argument parsing ----------
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const inputArg = positional[0];
if (!inputArg) {
    console.error("usage: ingest-reel.mjs <SHORTCODE|URL> [--skip-capture] [--skip-transcribe] [--model=base.en|tiny.en|small.en]");
    process.exit(1);
}
let shortcode;
const urlMatch = inputArg.match(/instagram\.com\/reel\/([A-Za-z0-9_-]+)/);
if (urlMatch) shortcode = urlMatch[1];
else if (/^[A-Za-z0-9_-]+$/.test(inputArg)) shortcode = inputArg;
else { console.error(`invalid input: ${inputArg}`); process.exit(1); }

const modelArg = args.find((a) => a.startsWith("--model="));
const WHISPER_MODEL = modelArg ? modelArg.slice("--model=".length) : "base.en";

const REEL_URL = `https://www.instagram.com/reel/${shortcode}/`;
const outDir = `${CAPS_DIR}/${shortcode}`;
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(`${outDir}/frames`, { recursive: true });

console.log(`==== ingest-reel: ${shortcode} ====`);
console.log(`     url: ${REEL_URL}`);
console.log(`     out: ${outDir}`);
console.log(`     model: ${WHISPER_MODEL}`);

// ---------- step 1+2: playwright capture + meta scrape ----------
async function captureAndScrape() {
    const browser = await chromium.launch({
        headless: true,
        args: ["--autoplay-policy=no-user-gesture-required"]
    });
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });
    const page = await ctx.newPage();
    await page.goto(REEL_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const meta = await page.evaluate(() => {
        const og = (k) => document.querySelector(`meta[property="${k}"]`)?.getAttribute("content") || null;
        return {
            ogTitle: og("og:title"),
            ogDescription: og("og:description"),
            ogImage: og("og:image"),
            ogUrl: og("og:url"),
            title: document.title
        };
    });

    // wait for <video>
    let hasVideo = false;
    for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1000);
        hasVideo = await page.evaluate(() => !!document.querySelector("video"));
        if (hasVideo) break;
    }
    if (!hasVideo) { await browser.close(); throw new Error("no <video> element appeared on page"); }

    const captureResult = await page.evaluate(async () => {
        return new Promise(async (resolve) => {
            const v = document.querySelector("video");
            v.muted = false; v.volume = 1;
            try { await v.play(); } catch { v.muted = true; await v.play().catch(() => {}); }
            await new Promise(r => setTimeout(r, 600));

            const stream = v.captureStream();
            const mime = "video/webm;codecs=vp9,opus";
            const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 });
            const chunks = [];
            rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            rec.start(1000);

            const target = v.duration || 160;
            const hardCapMs = Math.min(360_000, (target + 5) * 1000);
            const t0 = performance.now();
            let prev = v.currentTime;

            const watcher = setInterval(() => {
                const t = v.currentTime;
                if (prev - t > 5) { clearInterval(watcher); rec.stop(); return; }
                prev = t;
                if (v.ended) { clearInterval(watcher); rec.stop(); return; }
                if (v.duration && t >= v.duration - 0.3) { clearInterval(watcher); rec.stop(); return; }
                if (performance.now() - t0 >= hardCapMs) { clearInterval(watcher); rec.stop(); return; }
            }, 500);

            rec.onstop = async () => {
                const blob = new Blob(chunks, { type: mime });
                const buf = await blob.arrayBuffer();
                const bin = new Uint8Array(buf);
                let s = ""; const CHUNK = 0x8000;
                for (let i = 0; i < bin.length; i += CHUNK) s += String.fromCharCode.apply(null, bin.subarray(i, i + CHUNK));
                resolve({ size: bin.length, duration: v.duration, base64: btoa(s) });
            };
        });
    });

    await page.close(); await ctx.close(); await browser.close();
    return { meta, capture: captureResult };
}

// ---------- step 3: ffmpeg audio + frames ----------
function runOrThrow(cmd, args) {
    const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr?.toString().slice(0, 500)}`);
}

function extractAudio(webmPath, wavPath) {
    runOrThrow("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", webmPath, "-vn", "-ac", "1", "-ar", "16000", wavPath]);
}
function extractFrames(webmPath, framesDir) {
    runOrThrow("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", webmPath, "-vf", "fps=0.5", `${framesDir}/f%03d.png`]);
}

// ---------- step 5: whisper transcribe ----------
function transcribe(wavPath, outDir, model) {
    const r = spawnSync(WHISPER, [wavPath, "--model", model, "--output_format", "all", "--output_dir", outDir, "--language", "en", "--fp16", "False"], {
        stdio: ["ignore", "ignore", "pipe"]
    });
    if (r.status !== 0) throw new Error(`whisper failed: ${r.stderr?.toString().slice(0, 500)}`);
}

// ---------- og:title parser ----------
function parseOg(ogTitle, ogDescription) {
    if (!ogTitle && !ogDescription) return { handle: null, author: null, caption: null, hashtags: [], posted_at: null, engagement: null };
    // ogTitle pattern: '<Name> on Instagram: "<caption>..."'
    const titleM = ogTitle?.match(/^(.+?)\s+on Instagram:\s*"([\s\S]+)"$/);
    const author = titleM ? titleM[1].trim() : null;
    const caption = titleM ? titleM[2].trim() : (ogTitle || ogDescription || "");
    // ogDescription pattern: '<likes>K likes, <comments> comments - <handle> on <date>: "..."'
    const descM = ogDescription?.match(/^([\d,.]+(?:K|M)?)\s*likes?,\s*([\d,.]+)\s*comments?\s*-\s*([\w._]+)\s+on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
    let handle = null, posted_at = null, engagement = null;
    if (descM) {
        const likesRaw = descM[1].replace(/,/g, "");
        const likes = likesRaw.endsWith("K") ? Math.round(parseFloat(likesRaw) * 1000)
                    : likesRaw.endsWith("M") ? Math.round(parseFloat(likesRaw) * 1_000_000)
                    : parseInt(likesRaw, 10);
        const comments = parseInt(descM[2].replace(/,/g, ""), 10);
        engagement = { likes, comments };
        handle = `@${descM[3]}`;
        // convert "January 8, 2026" -> "2026-01-08"
        const d = new Date(descM[4] + " UTC");
        if (!isNaN(d)) posted_at = d.toISOString().slice(0, 10);
    }
    // hashtag extract
    const hashtags = Array.from((caption || "").matchAll(/#([A-Za-z0-9_]+)/g)).map((m) => m[1]);
    return { handle, author, caption, hashtags, posted_at, engagement };
}

// ---------- starter meta.json ----------
//
// Consumer-facing reminder: every field below that the gallery surfaces to readers
// (audio_track_actual, video_overlay_text_observed, audio_content_summary, implied_frame)
// MUST be written in third-person factual prose. No "TODO:" markers, no second-person
// address, no references to repo paths, evidence-record IDs, or workflow steps. The
// gallery skips empty strings, so leaving a field empty is preferable to filling it
// with backstage prose.
function writeStarterMeta(shortcode, parsed, captureSize, captureDuration) {
    const meta = {
        id: shortcode,
        url: `https://www.instagram.com/reel/${shortcode}/`,
        platform: "instagram",
        captured_at: new Date().toISOString().slice(0, 10),
        handle: parsed.handle,
        author_display_name: parsed.author,
        posted_at: parsed.posted_at,
        engagement: parsed.engagement,
        caption: parsed.caption,
        hashtags: parsed.hashtags,
        audio_track_actual: "",
        video_overlay_text_observed: "",
        audio_content_summary: "",
        implied_frame: "",
        capture_method: "Headless browser recording of the in-page <video> element via MediaRecorder over captureStream(), viewport 1280x800.",
        video_download_status: `Captured: ~${Math.round(captureSize / 1_000_000)} MB, vp9 720x1280, ${Math.round(captureDuration)}s.`,
        audio_transcription_status: "Transcribed with openai-whisper.",
        evidence_records: [],
        supporting_research_links: []
    };
    fs.writeFileSync(`${CAPS_DIR}/${shortcode}/meta.json`, JSON.stringify(meta, null, 4) + "\n");
}

function writeTranscriptWrapper(shortcode, model) {
    const raw = fs.readFileSync(`${CAPS_DIR}/${shortcode}/reel-audio.txt`, "utf8");
    // Consumer-facing: this file is loaded into the gallery's transcript drawer.
    // Editorial review (proper-noun fixes, miss-hears) belongs in the "Transcription notes"
    // section below, populated during the editorial pass — not as a TODO marker.
    const wrapped = `Source: reel.webm
Audio: opus 48kHz stereo extracted to 16kHz mono WAV
Transcribed: ${new Date().toISOString().slice(0, 10)}, openai-whisper ${model}

— FULL TEXT —

${raw.trim()}

— END —
`;
    fs.writeFileSync(`${CAPS_DIR}/${shortcode}/transcript.txt`, wrapped);
}

// ---------- manifest update ----------
function addToCapturesManifest(shortcode) {
    const p = `${CAPS_DIR}/manifest.json`;
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!m.captures.includes(shortcode)) {
        m.captures.push(shortcode);
        fs.writeFileSync(p, JSON.stringify(m, null, 4) + "\n");
        console.log(`     manifest: added ${shortcode}`);
    } else {
        console.log(`     manifest: ${shortcode} already present`);
    }
}

// ---------- main ----------
async function main() {
    const webmPath = `${outDir}/reel.webm`;
    const wavPath = `${outDir}/reel-audio.wav`;

    let captureMeta = { size: 0, duration: 0 };
    let parsedOg = { handle: null, author: null, caption: null, hashtags: [], posted_at: null, engagement: null };

    if (!flags.has("--skip-capture")) {
        console.log("[1/6] capture + scrape meta…");
        const { meta, capture } = await captureAndScrape();
        fs.writeFileSync(webmPath, Buffer.from(capture.base64, "base64"));
        fs.writeFileSync(`${outDir}/_meta_raw.json`, JSON.stringify(meta, null, 2));
        captureMeta = { size: capture.size, duration: capture.duration };
        parsedOg = parseOg(meta.ogTitle, meta.ogDescription);
        console.log(`     webm: ${Math.round(capture.size / 1_000_000)} MB, ${Math.round(capture.duration)}s`);
        console.log(`     handle: ${parsedOg.handle}   posted: ${parsedOg.posted_at}`);
    } else {
        if (!fs.existsSync(webmPath)) { throw new Error(`--skip-capture but no ${webmPath}`); }
        const raw = fs.existsSync(`${outDir}/_meta_raw.json`) ? JSON.parse(fs.readFileSync(`${outDir}/_meta_raw.json`, "utf8")) : {};
        parsedOg = parseOg(raw.ogTitle, raw.ogDescription);
        captureMeta = { size: fs.statSync(webmPath).size, duration: 0 };
        console.log("[1/6] capture skipped (using existing reel.webm)");
    }

    console.log("[2/6] extract audio (ffmpeg)…");
    extractAudio(webmPath, wavPath);

    console.log("[3/6] extract frames (ffmpeg @ 0.5fps)…");
    extractFrames(webmPath, `${outDir}/frames`);
    const frameCount = fs.readdirSync(`${outDir}/frames`).length;
    console.log(`     ${frameCount} frames`);

    if (!flags.has("--skip-transcribe")) {
        console.log(`[4/6] transcribe (whisper ${WHISPER_MODEL}, may take 1–3 min)…`);
        transcribe(wavPath, outDir, WHISPER_MODEL);
        console.log("     transcript.txt + .srt + .vtt + .json written");
    } else {
        console.log("[4/6] transcribe skipped");
    }

    console.log("[5/6] write meta.json + transcript wrapper…");
    writeStarterMeta(shortcode, parsedOg, captureMeta.size, captureMeta.duration);
    if (fs.existsSync(`${outDir}/reel-audio.txt`)) writeTranscriptWrapper(shortcode, WHISPER_MODEL);

    console.log("[6/6] update captures manifest…");
    addToCapturesManifest(shortcode);

    console.log("\n==== DONE ====");
    console.log(`  open: ${outDir}/transcript.txt`);
    console.log(`  edit: ${outDir}/meta.json   (TODO fields are explicit)`);
    console.log(`\nNext steps (editorial pass):`);
    console.log("  1. Read transcript.txt; sketch claims into Group A/B/C (verifiable / disputed / invented).");
    console.log("  2. For each Group A claim, write receipts/sources/evidence/<id>.json with sourced URLs.");
    console.log("  3. Add a `quote` field to the strongest primary source on each new record.");
    console.log("  4. Run clip-evidence.mjs against the new ids to generate inline clip screenshots.");
    console.log("  5. Update receipts/sources/evidence/manifest.json and the meta.json `evidence_records[]`.");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
