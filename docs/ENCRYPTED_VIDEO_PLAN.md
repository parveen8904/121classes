# Premium video — "own the brain, rent the pipe" (hybrid HLS)

**Status:** Planned (not built). Architecture chosen with the founder.
**Supersedes** the earlier "download one encrypted file, decrypt in browser" idea — that does **not** work for 3–4 hour lectures (too big to download/decrypt as one blob). For long videos the only correct approach is **adaptive HLS streaming**, which is also what Bunny/YouTube do.

## Decisions locked
- Videos are **3–4 hours** → must be **adaptive-bitrate HLS** (auto quality 240p–1080p, smooth on weak connections).
- **Hybrid**: **own** the security/control, **rent** the heavy infra.
  - **Own (build, ~free):** AES key store + access-gated **key endpoint**, **watermark**, the **player**, access control (reuse `has_subject_access`).
  - **Rent (commodity):** **transcode compute** + **storage + CDN delivery**.
- Free YouTube lectures stay plain YouTube embeds. This is only for genuinely premium, non-YouTube content.

## Why hybrid (the economics)
Bunny is ~₹0.5–1/GB because of massive scale; rebuilding transcode+CDN yourself usually costs **more** (24/7 transcode box + storage + egress + ops) until very large. So rent the muscle, own the brain. Independence comes from controlling keys/access/watermark/student-data — not from running a CDN.

## Architecture

### Pipeline
1. **Admin uploads the raw source** (3–4 hr file) via the admin panel to a staging bucket.
2. **Transcode + encrypt worker** (rented muscle — a small cloud VM/container or a transcode API running `ffmpeg`):
   - Transcodes to multiple renditions (e.g. 240/360/480/720/1080p), packaged as **HLS** (fMP4/TS segments + master `.m3u8`).
   - Encrypts segments with **AES-128** using a **random key we generate and keep** (HLS `#EXT-X-KEY` points the playlist at *our* key endpoint, not a static file).
   - Uploads the encrypted HLS output to **storage+CDN** (Bunny Storage+CDN or Cloudflare R2+CDN — used as a *dumb pipe*).
3. **Key + manifest saved** in our DB (`protected_videos`): the AES key (server-only), the CDN base URL, section link.

### Playback (student, web)
- Player = **hls.js** (handles AES-128 + adaptive bitrate natively — no custom crypto code needed).
- The playlist's key URL → **our access-gated key endpoint**: a route/RPC that returns the AES key **only** if the student is logged in **and** `has_subject_access(subject, min_plan)` passes. hls.js fetches segments from the **CDN** and the key from **us**, decrypts, and plays — auto-switching quality.
- **Watermark**: student email/id as a semi-transparent moving overlay above the `<video>`.
- Result: CDN can't serve a playable file (segments are encrypted), the key only comes from us after payment check, and the experience is smooth for 4-hour videos.

### Data model (when built)
```
protected_videos(id, section_id -> sections, cdn_base_url text,
  key_b64 text,           -- server-only; never exposed via RLS
  manifest jsonb, created_at)
-- RLS: no public select. Key released ONLY by:
get_hls_key(p_section uuid) returns text   -- SECURITY DEFINER, checks has_subject_access
```
New section type `protected_video` (or a flag on existing video types) wired into the section editor + topic player.

## What we BUILD now vs LATER
- **Buildable now (owned, free), even before picking a provider:** the `protected_videos` table + access-gated `get_hls_key` endpoint, the **watermark overlay**, and the **hls.js player** component + `protected_video` section type. These work against any HLS URL.
- **Needs a provider/decision:** the **transcode+encrypt worker** and **storage+CDN**. Two commodity choices:
  - **Bunny** (Storage + CDN as a dumb pipe; cheap, India-friendly). Transcode via own ffmpeg worker, then upload encrypted HLS.
  - **Cloudflare** (R2 storage + CDN; generous free egress). Same ffmpeg worker.
  - (If we ever accept Bunny's *own* DRM instead of our keys, we lose the "own the brain" property — avoid.)

## Open decisions (founder)
1. **Storage + CDN:** Bunny vs Cloudflare R2.
2. **Transcode worker:** self-host ffmpeg on a small VM, or a transcode API. (Admin browsers can't transcode 4-hr files.)

## Honest limits (unchanged)
- Stops casual sharing strongly (encrypted segments + gated key + watermark). A determined techie can still pull from browser memory or screen-record; only hardware DRM / native app fully closes that. Accepted for now.

## Suggested build order
1. (Owned, free) `protected_videos` + `get_hls_key()` migration + watermarked hls.js player + section type — works with any test HLS stream.
2. Pick storage/CDN + stand up the ffmpeg transcode+encrypt worker.
3. Wire admin upload → worker → CDN; point the player at it. Test with one real 3-hr lecture.
