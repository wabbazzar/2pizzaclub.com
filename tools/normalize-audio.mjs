// tools/normalize-audio.mjs
//
// EBU R128 two-pass loudness normalization for a single webm in place.
// Targets I=-16 LUFS, true peak -1.5 dBTP, LRA=11. Video stream is copied;
// only the audio is re-encoded (libopus 96k).
//
// Used by ingest-reel.mjs on freshly captured reels, and by
// normalize-captures.mjs to re-normalize the back catalog.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

function runOrThrow(cmd, args) {
    const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr?.toString().slice(-500)}`);
}

export function normalizeAudio(webmPath) {
    const tmpPath = `${webmPath}.norm.tmp.webm`;
    const r1 = spawnSync("ffmpeg", [
        "-hide_banner", "-nostats", "-i", webmPath,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
        "-vn", "-f", "null", "-"
    ], { stdio: ["ignore", "ignore", "pipe"] });
    if (r1.status !== 0) throw new Error(`loudnorm pass1 failed: ${r1.stderr?.toString().slice(-400)}`);
    const stderr = r1.stderr.toString();
    const jsonStart = stderr.lastIndexOf("{");
    const jsonEnd = stderr.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("loudnorm pass1: no measurement json in output");
    const m = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1));
    const af = `loudnorm=I=-16:TP=-1.5:LRA=11`
        + `:measured_I=${m.input_i}:measured_TP=${m.input_tp}`
        + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}`
        + `:offset=${m.target_offset}:linear=true:print_format=summary`;
    runOrThrow("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", webmPath, "-map", "0",
        "-c:v", "copy", "-af", af, "-c:a", "libopus", "-b:a", "96k",
        tmpPath
    ]);
    fs.renameSync(tmpPath, webmPath);
    return {
        input: { I: m.input_i, TP: m.input_tp, LRA: m.input_lra },
        output: { I: m.output_i, TP: m.output_tp, LRA: m.output_lra }
    };
}
