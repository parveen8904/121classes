# 121 CA Classes — Desktop app (Mac / Windows)

Downloads **encrypted** class videos and plays them **offline** after verifying the
student's access against the website. The encrypted file on disk is useless
without the AES key, and the key is only released by the server (`/api/app/license`)
to a logged-in student who still has access.

## How it works
1. Student signs in (same account as the website, via Supabase).
2. App lists the classes they can download (`GET /api/app/classes` → `list_downloadable_classes`, no keys).
3. **Download**: fetches the `.enc` file from the CDN into app storage.
4. **Play**: app calls `POST /api/app/license` → server re-checks `has_subject_access` and returns the AES key + a watermark (the student's email). The main process decrypts to a temp file, plays it with the watermark overlay, and wipes the temp file on quit.

## Run it (dev)
```
cd desktop
cp config.example.js config.js      # then paste the publishable anon key
npm install
npm start
```

## Build installers
```
npm run dist:mac     # .dmg
npm run dist:win     # .exe (NSIS)
```

## Publishing a class (admin)
1. `node ../scripts/encrypt-class.mjs class.mp4` → prints key/iv/size, writes `class.enc`.
2. Upload `class.enc` to your CDN (e.g. Bunny **Storage**).
3. Admin → **Downloadable classes** → register: title, subject, the CDN URL, key, iv, size.

## Security posture (honest)
Strong + traceable, not unbreakable. Encrypted at rest, key only after access
check, per-play re-verification, watermark on the player. A determined user can
still screen-record or attack memory — the watermark makes leaks traceable.
**Hardening TODO:** stream-decrypt to an in-memory/custom-protocol source instead
of a temp file; optional time-limited offline license; disable right-click/devtools
in production; code-sign the installers.
