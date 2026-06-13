# Self-hosted encrypted premium video — implementation plan

**Status:** Planned (not built). Decided with the founder.
**Decisions locked:**
- **Zero recurring cost / no third-party video DRM** (no Bunny, VdoCipher, etc.). Use existing **Supabase** storage + DB only.
- **Admin encrypts on upload**; encrypted files are useless outside the app.
- **Online verification each play**: the decrypt key is released only after the server checks login **and** paid access.
- **Videos are 1 hour+** → use **chunked encryption** (decrypt-as-you-watch), not whole-file.
- Free YouTube lectures stay as plain YouTube embeds — only genuinely premium (non-YouTube) videos use this.

---

## Threat model (be honest)
- ✅ Stops the casual 90–99%: the downloaded file is AES gibberish — won't open in VLC/any player/browser, and can't be decrypted without logging in + having access.
- ❌ Does **not** stop a determined technical user: the final decrypt happens in the browser (JS/Web Crypto), so the key and decrypted frames are extractable from browser memory; screen-recording always possible. Only hardware DRM (Widevine/FairPlay) or a native app closes this. Accepted trade-off for self-hosted + zero cost.

## Architecture

### 1. Admin encrypt-on-upload (browser-side, no external tools)
- New admin page / control on a `revision_video`/`full_class_video`/`custom` section: "Upload protected video".
- In the browser (Web Crypto API):
  1. Generate a random **AES-GCM 256 key** + per-chunk IVs.
  2. Read the picked video file, split into **~5–10 MB chunks**, encrypt each chunk.
  3. Upload encrypted chunks to a **private** Supabase Storage bucket `protected/` (path e.g. `protected/<videoId>/<n>.enc`), plus a small **manifest** (chunk count, sizes, IVs, mime, duration).
  4. POST the **key + manifest + storage path** to the server → stored in a `protected_videos` row.
- The plaintext video never touches our server unencrypted; encryption happens on the admin's machine.

### 2. Data model (migration, when built)
```
protected_videos(
  id uuid pk, section_id uuid -> sections, storage_prefix text,
  key text,            -- base64 AES key (server-only; never exposed by RLS)
  manifest jsonb,      -- {chunks:[{path,iv,size}], mime, duration}
  created_at timestamptz
)
-- RLS: NO public select. Admin manage only.
-- Key release ONLY via a SECURITY DEFINER function that re-checks access:
get_protected_key(p_section uuid) returns text
  -- returns key iff has_subject_access(section's subject, section.min_plan) is true
```
Private storage bucket `protected` (admin write; **no public read** — students get short-lived **signed URLs** per chunk from a server route after the access check).

### 3. Student playback (web app)
- A protected section shows **"Download & play"**.
- Flow:
  1. App calls a server route → checks `has_subject_access` → returns signed URLs for the encrypted chunks (+ manifest).
  2. App calls `get_protected_key(section)` (online verification) → gets the AES key.
  3. App uses **Media Source Extensions (MSE)**: fetch chunk → decrypt with Web Crypto → append to the video buffer → play. Decrypt-as-you-watch keeps memory low for 1hr+ videos; supports seeking.
  4. **Watermark overlay**: student email + id rendered semi-transparent over the `<video>` (CSS overlay; moving position to deter cropping).
- Offline: optional later — chunks can be cached (IndexedDB), but the **key fetch stays online** (matches "verify through internet each time"). True offline = native app.

### 4. Security details
- Key is **never** in the encrypted files, never in a public table, never in the page source — only returned by the access-checked function over HTTPS at play time.
- Encrypted bucket is private; chunk URLs are short-lived signed URLs.
- Same subscription gate as sections (`has_subject_access`) so per-subject/tier access is respected automatically.
- Rotate/revoke: deleting the `protected_videos` row (or subscription expiry) kills playback.

## Cost
- No DRM-vendor fees. **Only** Supabase storage + egress as the library grows (encrypted size ≈ original size). Budget Supabase storage/bandwidth at scale.

## Effort (rough)
1. Migration: `protected_videos` + `get_protected_key()` + `protected` bucket/policies (via MCP). — small
2. Admin browser encryptor + upload (chunked AES-GCM, manifest). — medium
3. Server route: access check → signed chunk URLs. — small
4. Student MSE decrypt player + watermark overlay. — medium/large (the trickiest part: MSE + per-chunk decrypt + seeking across browsers)
5. Wire into the section editor + topic player as a new "Protected video" section type.

## Known risks
- MSE + Web Crypto across browsers (esp. iOS Safari) needs care; fMP4 chunking required for MSE.
- Long videos: chunk size tuning for smooth playback on low-end phones.
- This is bespoke crypto/playback code — more moving parts than embedding YouTube; test thoroughly.

---
**To start:** founder says "build it" → begin with step 1 (migration) + a small test video to validate the MSE decrypt pipeline before wiring the full UI.
