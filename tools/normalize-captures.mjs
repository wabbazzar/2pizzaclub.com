#!/usr/bin/env node
// tools/normalize-captures.mjs
//
// Apply EBU R128 loudness normalization (loudnorm two-pass, -16 LUFS / -1.5 dBTP)
// to every captured reel.webm in place.
//
// Usage:
//   node tools/normalize-captures.mjs                # all captures in the manifest
//   node tools/normalize-captures.mjs <id> [<id>...]  # specific ids only
//   node tools/normalize-captures.mjs --dry-run      # report measurements only, don't rewrite

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { normalizeAudio } from "./normalize-audio.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAPS_DIR = `${ROOT}/sources/captures`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const explicit = args.filter((a) => !a.startsWith("--"));

const manifest = JSON.parse(fs.readFileSync(`${CAPS_DIR}/manifest.json`, "utf8"));
const ids = explicit.length ? explicit : (manifest.captures || []);

console.log(`==== normalize ${ids.length} captures (dry-run=${dryRun}) ====\n`);

const before = [];
const after = [];
const errs = [];

function measure(webmPath) {
    const r = spawnSync("ffmpeg", [
        "-hide_banner", "-nostats", "-i", webmPath,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
        "-vn", "-f", "null", "-"
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const stderr = r.stderr.toString();
    const s = stderr.lastIndexOf("{"), e = stderr.lastIndexOf("}");
    if (s < 0) return null;
    return JSON.parse(stderr.slice(s, e + 1));
}

for (const id of ids) {
    const webm = `${CAPS_DIR}/${id}/reel.webm`;
    if (!fs.existsSync(webm)) { console.warn(`  ${id}: missing ${webm}`); continue; }
    try {
        if (dryRun) {
            const m = measure(webm);
            console.log(`  ${id}: I=${m.input_i} LUFS, TP=${m.input_tp} dBTP, LRA=${m.input_lra}`);
            before.push({ id, I: parseFloat(m.input_i), TP: parseFloat(m.input_tp) });
        } else {
            const sizeBefore = fs.statSync(webm).size;
            const r = normalizeAudio(webm);
            const sizeAfter = fs.statSync(webm).size;
            before.push({ id, ...r.input });
            after.push({ id, ...r.output });
            const dBefore = `I=${r.input.I} TP=${r.input.TP}`;
            const dAfter = `I=${r.output.I} TP=${r.output.TP}`;
            const sizeDelta = `${(sizeBefore / 1_000_000).toFixed(1)}→${(sizeAfter / 1_000_000).toFixed(1)} MB`;
            console.log(`  ${id}: ${dBefore}  →  ${dAfter}   (${sizeDelta})`);
        }
    } catch (e) {
        errs.push({ id, msg: e.message });
        console.warn(`  ${id}: FAILED — ${e.message.slice(0, 200)}`);
    }
}

if (!dryRun) {
    const clippedBefore = before.filter((b) => parseFloat(b.TP) > -1).length;
    const clippedAfter = after.filter((a) => parseFloat(a.TP) > -1).length;
    console.log(`\n==== summary ====`);
    console.log(`  processed: ${after.length}`);
    console.log(`  errors:    ${errs.length}`);
    console.log(`  files with TP > -1 dBTP before: ${clippedBefore}`);
    console.log(`  files with TP > -1 dBTP after:  ${clippedAfter}`);
}
