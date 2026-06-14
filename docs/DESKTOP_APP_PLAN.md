# Desktop app — downloadable encrypted classes (Mac / Windows)

**Status:** Foundation built 2026-06-14. Decision: a **native desktop app** is the
way to give students an offline **download** feature with **encrypted** content —
a browser/web app cannot do secure encrypted offline (especially iOS). Founder
accepts the realistic security posture ("strong + traceable, not unbreakable")
in exchange for the feature. **Bunny stays** for web streaming + free content;
encrypted downloads use our own AES key + CDN-as-dumb-pipe.

## Architecture
```
 Admin                         Website (this repo)                Desktop app (desktop/)
 encrypt-class.mjs  ──.enc──▶  CDN (Bunny Storage / R2)  ──download──▶  app cache (encrypted)
        │                                                                     │
   key + url ──register──▶  protected_videos (key server-only)               │ play ▶
                                   ▲                                          ▼
                          /api/app/classes  (catalog, NO key) ◀── list ── renderer
                          /api/app/license  (AES key, after has_subject_access) ◀──
```
Security boundary = **the key**, not the file. The `.enc` file can sit on a public
CDN; it's useless without the key, which the server only releases to a logged-in
student who passes `has_subject_access`.

## Built (web side — live)
- **DB** (`migration 0011 protected_downloadable_classes`): `protected_videos`
  (key_b64 server-only, RLS = no client reads) + SECURITY DEFINER funcs
  `list_downloadable_classes()` (catalog, no key) and `get_protected_class_key(id)`
  (key only if access passes).
- **API** for the app: `GET /api/app/classes`, `POST /api/app/license` (Bearer-token
  auth via `lib/supabase/token.ts`, permissive CORS).
- **Admin**: `/admin/protected` — register an encrypted class (title, subject,
  min_plan, CDN url, key, iv, size).
- **Tooling**:
  - `scripts/encrypt-class.mjs` — AES-256-CBC encrypts a video, prints key/iv/size (manual host + register).
  - `scripts/publish-class.mjs` — **one command**: encrypt → upload to **Bunny Storage** → auto-register in `protected_videos`. Runs locally (NOT Vercel — serverless can't encrypt multi-GB files). Needs `BUNNY_STORAGE_ZONE/KEY`, `BUNNY_PULL_ZONE_HOST`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Usage: `node scripts/publish-class.mjs class.mp4 "FR — AS 24 Class 1" financial-reporting`.
- **Landing app links**: a "Get the app" section on `/` with Web/Mac/Windows/iPhone/Android
  buttons, each an admin-set URL (`site_settings.app_url_*`, editable in Admin → Site).
  Unset = "Coming soon". Web defaults to `/login`. iOS/Android are placeholders — no
  mobile apps exist yet.

## Built (desktop scaffold — `desktop/`, needs `npm install` + content)
Electron app: login (Supabase) → list classes → download `.enc` → per-play license
re-check → decrypt in main process → play with watermark → wipe temp on quit.
Runnable starting point; see `desktop/README.md`.

## Still needed
1. **A decryptable repository of classes.** Produce encrypted files: run
   `encrypt-class.mjs`, upload `.enc` to a CDN, register in admin. Decide storage:
   **Bunny Storage** (keeps "Bunny stays", India-friendly) vs Cloudflare R2.
   *(Note: this is separate from Bunny **Stream** — Stream won't hand us our-key
   encryption, so downloads use Bunny Storage as a plain file/CDN host.)*
2. **Fill `desktop/config.js`** with the publishable anon key; `npm install`; test
   end-to-end with one real class.
3. **Hardening** (see README): in-memory/stream decryption instead of temp file,
   time-limited offline license, disable devtools/right-click, **code-sign**
   installers (Apple Developer ID + Windows cert) so they install without warnings.
4. **Decide validity/offline rules** (e.g. require re-verification every N days
   offline) — ties into the per-subject validity already in the platform.

## Honest limits
Encrypted at rest + gated key + per-play re-check + watermark stops casual sharing
strongly and makes any leak traceable. Determined screen-recording/memory attacks
remain possible; only a paid DRM SDK (e.g. VdoCipher) closes those fully, at extra
cost — can be swapped in later behind the same `/api/app/*` shape.
