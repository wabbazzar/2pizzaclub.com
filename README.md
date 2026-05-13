# 2pizzaclub.com

A sourced editorial timeline. Each entry on the page links to a primary
source — court filings, government records, contemporary news reporting,
flight data, financial disclosures, oral histories, and the social-media
posts that put them back in circulation. The site presents what is on the
record. The reader decides what it adds up to.

## Site shape

- `index.html` — the timeline, organized in eras, threaded by theme
- `gallery/` — captured reels with transcripts, evidence links, and notes
- `sources/evidence/` — one JSON record per claim, each with citations
- `sources/captures/` — one folder per captured reel: meta, transcript, video
- `chapters/narrative.json` — the prose narrative for each era

## Voice

Every line that renders to a visitor is third-person and source-led.
There are no second-person addresses, no backstage notes, no working
markers, and no internal repo references in the rendered output.

## Stack

Plain HTML, CSS, and ES modules. No build step. No bundler. No tracking.
Hosted on GitHub Pages. Custom domain via Porkbun.

## Media

Reels are captured to `sources/captures/<id>/reel.webm` (vp9, ~720x1280)
via a headless-browser MediaRecorder pipeline (`tools/ingest-reel.mjs`).
Transcripts come from `openai-whisper base.en`. The intermediate audio
(`reel-audio.wav`, `.srt`, `.vtt`, `.tsv`) and per-frame PNG stacks beyond
the poster are regenerable and are excluded from the repository via
`.gitignore` to keep the public clone lean.

## Security

- `.gitignore` keeps `.env`, key material, and credential files out
- `.gitleaks.toml` extends the default ruleset with project-specific
  patterns (Porkbun, Anthropic, OpenAI)
- `.github/workflows/secret-scan.yml` runs gitleaks on every push, every
  pull request, and once a week as a backstop

## Author

Wesley Beckner · [wabbazzar.com](https://wabbazzar.com)
