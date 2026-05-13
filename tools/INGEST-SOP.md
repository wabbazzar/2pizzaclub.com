# Reel ingest — standard operating procedure

The procedure I (Claude) follow for each new reel the user drops.

Goal: minimum-token, deterministic-where-possible, predictable artifacts.

## House style — public-facing voice

**The site is consumer-facing. Every field that the gallery or main page surfaces to a reader must be written in third-person factual prose. No exceptions.**

This means, anywhere a reader can see it:

- No `TODO:` markers, no `// FIXME`, no "left as a follow-on pass."
- No second-person address ("you", "if you want"). No "Per the user…" or "the user explicitly asked…".
- No references to internal repo structure ("see meta.json `field_X`", "in receipts/sources/…", evidence-record IDs in prose).
- No first-person ("I clipped this", "I traced…"). Editorial framing reads in the third person ("the reel claims…", "Maher concluded…", "AAP rated this false").
- Tools, models, and capture methods may appear in dedicated metadata fields (e.g. `capture_method`, `audio_transcription_status`), but they should read as neutral archival metadata, not as a workflow log.

Where to put backstage notes: inside an evidence record's `notes` field (the gallery and the main page do NOT render `notes`), or in a sidecar markdown file under `receipts/sources/captures/<id>/` not named `transcript.txt` (the gallery only renders `transcript.txt`).

Gallery-rendered fields, as of this SOP:
- `caption`, `handle`, `posted_at`, `engagement`, `hashtags` — populated from og:* meta, OK as-is.
- `audio_track_actual` — describe in plain English what the audio actually is.
- `video_overlay_text_observed` — describe what a viewer literally sees overlaid on the video.
- `audio_content_summary` — multi-sentence third-person summary of what the audio claims, what's verified, what isn't. This is the panel labeled "what the audio claims, and what's verified."
- `implied_frame` — one-paragraph third-person reading of what the reel is suggesting beyond what it states. Panel labeled "what the reel is framing."
- `transcript.txt` — the body content + minimal source provenance header + whisper accuracy notes. No editorial commentary in this file.

Fields NOT rendered to consumers (safe place for internal notes):
- Each evidence record's `notes` field.
- The capture's `editorial_handling` field, if present (deprecated; existing files may still have it).
- Any file in the capture directory other than `meta.json`, `transcript.txt`, `reel.webm`, and `frames/`.

## One-liner per reel

```bash
cd /home/wabbazzar/.claude/plugins/cache/dev-browser-marketplace/dev-browser/66682fb0513a/skills/dev-browser
node /home/wabbazzar/code/wabbazzar.github.io/receipts/tools/ingest-reel.mjs <SHORTCODE>
```

Accepts a full IG URL too (`https://www.instagram.com/reel/<SHORTCODE>/`). Default model is `base.en`. Override with `--model=small.en` for higher-stakes transcription. Use `--skip-capture` to reuse an existing `reel.webm`. Use `--skip-transcribe` to skip whisper.

What this writes:
- `receipts/sources/captures/<SHORTCODE>/reel.webm` — full video, vp9/opus
- `receipts/sources/captures/<SHORTCODE>/reel-audio.wav` — 16k mono for whisper
- `receipts/sources/captures/<SHORTCODE>/reel-audio.{txt,srt,vtt,json}` — whisper output
- `receipts/sources/captures/<SHORTCODE>/frames/f###.png` — frames @ 0.5fps for visual scan
- `receipts/sources/captures/<SHORTCODE>/meta.json` — skeleton with caption/handle/posted/engagement filled, TODO fields explicit
- `receipts/sources/captures/<SHORTCODE>/transcript.txt` — wrapped transcript with editorial notes section
- `receipts/sources/captures/<SHORTCODE>/_meta_raw.json` — raw og:* dump for re-parsing if needed
- Adds `<SHORTCODE>` to `receipts/sources/captures/manifest.json`

## Editorial pass (mine)

After ingest:

1. **Read `transcript.txt`.** Quickly fix obvious whisper miss-hears in place (proper nouns, technical terms).

2. **Open `meta.json`.** Fill these TODO fields with your editorial judgment:
   - `audio_track_actual` — creator's voice / music bed / remix of someone else's clip / AI clone? Cite where you can.
   - `video_overlay_text_observed` — scan `frames/` for persistent overlay text; note in 1–2 sentences.
   - `audio_content_summary` — what the reel SAYS, with provenance check on each substantive claim. Categorize as real-and-documented / disputed / unsupported / invented.
   - `implied_frame` — what the reel is suggesting beyond what it states.
   - `editorial_handling` — enumerate which threads will get evidence records (Group A) and which stay meta-only (Group C).

3. **Triage claims into Group A / B / C** (in `audio_content_summary`):
   - **A. Verifiable real anchors** — events that actually happened and have primary or strong-secondary sources. → Get evidence records.
   - **B. Disputed basis** — real underlying claim, contested interpretation. → Get evidence records, flagged.
   - **C. Pure invention / surfaced-only** — no external source. → Documented in meta, NOT promoted.

4. **For each Group A item:**
   1. Search the web for 1–2 candidate primary URLs (`WebSearch`).
   2. Fetch the strongest URL (`WebFetch`) and extract a verbatim 15–25 word quote.
   3. Write `receipts/sources/evidence/<id>.json` per `receipts/sources/SCHEMA.md`. Include the reel as a `type: "reel"` surfacing source.
   4. Add the quote to the strongest primary source on the record.

5. **Append the new evidence IDs** to:
   - `receipts/sources/evidence/manifest.json` `records[]`
   - `meta.json` `evidence_records[]`

6. **Run clip-evidence** to generate inline screenshots:
   ```bash
   cd /home/wabbazzar/.claude/plugins/cache/dev-browser-marketplace/dev-browser/66682fb0513a/skills/dev-browser
   node /home/wabbazzar/code/wabbazzar.github.io/receipts/tools/clip-evidence.mjs <id1> <id2> ...
   ```
   Tool tries: exact in-node → cross-node Range fallback → head60 → cross-node60 → head30 → cross-node30. Logs which method matched. Sets `clip_status` on each source: `ok-<method>`, `http-<status>`, `quote-not-found`, or `error: ...`.

## Heuristics — quote selection

Maximize clip success rate by picking quotes the matcher can find on the actual rendered page:

- **Short over long.** Aim for 8–15 words. The matcher's head60 fallback truncates, but a too-long quote often misses the head60 boundary too.
- **Avoid hyperlinked spans.** On Wikipedia, named entities ("Charlie Kirk", "Utah Valley University", dates) are typically `<a>` tags that split text nodes. The cross-node fallback handles these but exact-match is faster. Pick quotes BETWEEN linked terms when possible.
- **Avoid em-dashes and curly quotes.** The matcher normalizes them, but exact-text from the user is more reliable than a hand-typed quote.
- **Prefer prose paragraphs over infoboxes.** Sidebar text often has unusual DOM structure.

## Heuristics — source preference

Per record, one clip from the strongest primary. Order of preference for clip target URL:

1. Official government primary (DOJ, FBI, Senate, State Department, court records)
2. Wikipedia (very reliable for clip matching, secondary but high-fidelity summaries)
3. Mainstream news (CNN, ABC, NYT, WaPo) — often Cloudflare-walled in headless, retry with cookies if needed
4. Special-interest secondaries (Snopes, RCFP, NSA briefing books)
5. Internet Archive (always reachable; great for declassified PDFs and dead-link rescue)

If WebFetch returns 402/403 on a URL, that URL is almost certainly going to fail in headless Playwright too. Swap to a different source.

## When things go wrong

- **`quote-not-found`**: shorten the quote, or pick text from BETWEEN hyperlinks. Cross-node fallback handles inline `<a>`/`<span>` but breaks when text is in canvases, shadow DOM, or generated post-load.
- **`http-403` / `http-402`**: the page is bot-walled. Swap to a different source URL. Try Wikipedia or Internet Archive.
- **`http-200` but `quote-not-found`**: the page has the text but Playwright sees a different version (e.g., paywall fence, A/B test). Check by visiting the URL in your default browser. Often a header-stripped IA snapshot works.
- **No `<video>` element on IG reel**: viewport too small (IG redirects to mobile login). Use 1280x800.
- **Playwright `__name not defined`**: don't write inline `page.evaluate(() => { function ... })` in TypeScript files — tsx wraps named functions in `__name()`. Either use `.mjs` plain JS or pass an externally-defined plain-JS function.

## Token-budget heuristics (mine)

For each reel:
- 1 capture script call (run ingest-reel.mjs and let it stream output)
- 1 read of transcript.txt
- 3–5 `WebSearch` calls
- 3–6 `WebFetch` calls for verbatim quotes
- 1–5 evidence-record writes per Group A item
- 1 clip-evidence call covering all the new ids
- 2 manifest edits (evidence + meta)

Aim for ~10–15K input tokens of search/fetch per reel and ~5K of writes. If you find yourself spelunking more, the reel probably needs scope-cutting — pick the strongest 3 claims and ship.

## Quality gates before reporting "done"

- All Group A records have at least one source with a non-null URL and a `quote` field.
- `clip-evidence.mjs --all` shows `ok-*` for every record you intended to clip.
- `meta.json` has NO `TODO:` strings remaining.
- Both manifests include the new IDs.
- A spot-check screenshot of the new chapter shows the clips rendering inline.
