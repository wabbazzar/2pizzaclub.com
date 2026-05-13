# Evidence record schema

Every claim on the site lives as a JSON record under `sources/evidence/<id>.json`. The site renders these as cards inside the chapter at `data-anchor` matching the record's `anchor`. `manifest.json` lists which records are live.

## Record shape

```json
{
    "id": "1973-cl-001",
    "anchor": "y1973",
    "year": 1973,
    "era": "i" | "ii" | "iii" | "iv",
    "themes": ["cia", "regime-change", "..."],
    "claim": "One-sentence factual claim, written so a reader can evaluate it.",
    "sources": [
        {
            "label": "Citation as a reader would see it.",
            "type": "primary" | "secondary" | "reel" | "doc" | "court" | "data",
            "url": "https://..." | null,
            "quote": "verbatim text on the source page that supports the claim" | undefined,
            "clip": "clips/<evidence-id>-<n>.png" | undefined,
            "clip_status": "ok-<method> | http-<n> | quote-not-found | error: ..." | undefined
        }
    ],
    "status": "draft" | "verified" | "primary-link-pending",
    "notes": "Free-form internal notes. Not shown on site."
}
```

## ID convention

`<year>-<topic-slug>-<seq>` — e.g. `1973-cl-001`, `2019-epstein-003`, `2008-gfc-002`. Sequence is per-anchor, not global. Stable; never renumber.

## Adding a new record

1. Write the JSON file under `sources/evidence/<id>.json`.
2. Add the filename to `sources/evidence/manifest.json` `records[]`.
3. Reload the site — the card appears under its `anchor`.

## URL hygiene

Set `url: null` when the citation is real but a stable primary URL is still being chased. The card renders the label as plain text. Never put a URL into a record without first opening it and confirming the page actually supports the claim.

## Quotes and clips (in-place evidence)

To let readers see the source without leaving the site, populate a `quote` field on the strongest primary source per record with the verbatim text from the source page that supports the claim. Then run:

```
cd /home/wabbazzar/.claude/plugins/cache/dev-browser-marketplace/dev-browser/66682fb0513a/skills/dev-browser
npx tsx /home/wabbazzar/code/2pizzaclub.com/tools/clip-evidence.mjs <evidence-id>
# or --all to walk every record in the manifest
```

The tool opens each source URL in headless Chromium, finds the quote on the page, injects a yellow highlight, screenshots a cropped region around it, writes `sources/clips/<evidence-id>-<n>.png`, and writes `clip` + `clip_status` back into the record. The evidence card renders the clip below the citation line (with the URL still linked underneath).

When the quote can't be found or the page won't load, `clip_status` records the reason (`http-403`, `quote-not-found`, etc.) and no clip image is created — the citation degrades gracefully to a plain link.

## Source types

- **primary** — original document (declassified record, court filing, hearing transcript, raw dataset).
- **secondary** — analytical or journalistic source citing primary material (book chapter, investigative article).
- **reel** — an Instagram reel or video. Should be paired with at least one primary or secondary citation for the same claim. Never ship a claim sourced only to a reel.
- **doc** — a non-government primary document (corporate filing, leaked memo).
- **court** — court filing, deposition, indictment.
- **data** — quantitative dataset (FEC, BEA, polling).
