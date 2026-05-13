# One-shot reel capture procedure

This is the procedure Claude runs when you paste a single reel URL in chat. There is no script; the steps are deterministic and run via the `dev-browser` skill plus web research tools.

## Inputs

- A reel URL (Instagram, TikTok, X, YouTube Short, etc.).
- Optional: your one-line note on what claim the reel makes that's worth pursuing.

## Steps

1. **Capture id = platform shortcode** (e.g. Instagram reel `DVOtv6QCTFf`). One capture; one folder. Stable, lets us reference the source forever even if the post is deleted.
2. **Evidence ids = `<year>-<topic-slug>-<seq>`** where year is the *event* year a particular claim discusses (not the upload year). A single capture can produce **multiple** evidence records — one per distinct factual claim — so this id is per-claim, not per-reel.
3. **Capture**: open the URL with `dev-browser`. Dismiss any login modals. If the platform is auth-walled (Instagram, TikTok), try yt-dlp with `--cookies-from-browser`; if that fails, scrub the page-embedded video element through several timestamps and screenshot frames to recover overlay text. Save artifacts to `receipts/sources/captures/<capture-id>/`.
4. **Scrape**: extract caption text, @handle, hashtags, posted-at date, and audio track from the DOM and `og:` meta tags. Save to `receipts/sources/captures/<capture-id>/meta.json`:
    ```json
    {
        "id": "<capture-id>",
        "url": "...",
        "platform": "instagram" | "tiktok" | ...,
        "captured_at": "ISO-8601",
        "handle": "@...",
        "author_display_name": "...",
        "posted_at": "ISO-8601 | null",
        "engagement": { "likes": 0, "comments": 0 },
        "caption": "...",
        "hashtags": ["..."],
        "audio_track": "...",
        "video_overlay_text_observed": "...",
        "implied_frame": "What the reel is *suggesting* without sourcing. Documented here; never promoted to an evidence record without a separate citation.",
        "capture_method": "playwright-screenshot+caption-scrape | yt-dlp | user-supplied",
        "video_download_status": "...",
        "audio_transcription_status": "...",
        "evidence_records": ["<evidence-id>", "..."]
    }
    ```
5. **Decompose**: split the caption + observed overlays into a list of distinct factual claims. Note the reel's *implied frame* separately — anything the reel suggests without saying is documented in `meta.json` but does **not** become an evidence record on its own.
6. **Discover**: for each verifiable factual claim, search for primary sources (declassified docs, court records, FRUS volumes, dataset releases, hearings). **Open every URL before citing it.** Save each claim as a draft evidence record at `receipts/sources/evidence/<evidence-id>.json` per `sources/SCHEMA.md`. Include the reel as a `"type": "reel"` source (the surfacing source), but always pair with at least one `primary` or `secondary` that supports the claim independently.
7. **Register**: add each new `<evidence-id>.json` to `receipts/sources/evidence/manifest.json`.
8. **Report**: show the user the capture screenshot, the drafted claims, and the sources found. They edit before commit.

## Auth-gated reels

Instagram and TikTok gate a lot of content behind login and run aggressive bot detection. When `dev-browser` hits a wall:

- Fall back to asking the user for a phone-side screenshot + caption paste.
- Still run steps 4–6 (discovery + draft evidence record).
- Mark the capture's `meta.json` with `"capture_method": "user-supplied"`.

## What this procedure never does

- Never invent a URL for a primary source. If the URL can't be opened and confirmed, leave it `null` and set `status: "primary-link-pending"`.
- Never ship a claim that is only sourced to a reel.
- Never write prose into the chapter body. That's the user's job.
