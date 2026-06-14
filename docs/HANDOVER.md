# Handover Memo — 1:1 CA Classes Platform

_Last updated: 2026-06-14_

> Audience: an incoming engineer/operator who must continue this work **without** access to the original chat. Everything material is captured here.

---

## 1. Executive Summary

**The matter.** Building and operating "1:1 CA Classes" (brand also written "121 CA Classes"), an online coaching platform for Indian Chartered Accountancy (CA) students. Live at **121caclasses.com** / **www.121caclasses.com**. Founder is **CA Parveen Sharma** (email **ps.smay@gmail.com**; an Aldine-domain address `ra***@aldine.edu.in` is also used for Apple notarization). The founder is **non-technical** — instructions must be concrete, and the assistant performs the technical execution.

**Current status.** Core platform is live and feature-rich: tiered courses/subjects/topics, per-tier pricing, flexible Gold validity, encrypted **downloadable classes** delivered through a **signed/notarized Mac + Windows desktop app** (Electron), inline YouTube-style comments, a community board, dashboard announcements, AI-generated tests, live-class scheduling, bulk-notification composer, and an installable **PWA**. The encrypted-download pipeline is **proven end-to-end**.

**Most recent action (this session).** Uploaded the **v2** desktop installers directly to Bunny Storage, pointed the website download buttons at them, and resolved a Mac "old app won't delete" problem (app was running from a mounted DMG). Both items are now **complete**.

---

## 2. Key Facts and Background

### People & roles
- **Founder:** CA Parveen Sharma — non-technical; owns the business, has an **Apple Developer account**, owns the existing site **aldine.edu.in**.
- **Assistant role:** does all technical build/deploy; never logs in as the user; never asks the user to paste secrets into chat.

### Business / product
- Audience: ~**20,000 students** (target reach for bulk notifications).
- Tier model (three plans):
  - **Gold** — paid, **per-subject pricing**, with **flexible validity** (admin- and student-selectable months).
  - **Silver** — paid, **one flat price for all subjects**.
  - **Bronze** — **free**.
- Some subjects are **bundle-only** (priced inside a bundle rather than standalone).
- Telegram channel **@caparveen** is linked across the product; one channel post reaches all members.

### Technical stack
- **Next.js 14 App Router** (TypeScript, Server Components/Actions).
- **Supabase** (Postgres + RLS + Auth + Storage), project ref **`ydpkcmyjkekvfwnnvphn`**. Access-gated data via **SECURITY DEFINER** Postgres functions.
- **Vercel** — auto-deploys on push to `main`.
- **Electron** desktop app (electron **31.7.7**, electron-builder) — the desktop app loads the **full website** (`https://www.121caclasses.com/dashboard`) and adds offline download/play.
- **Bunny** — Storage zone **`ca-classes`** (region **Singapore**, endpoint `sg.storage.bunnycdn.com`); CDN pull zone **`ca-classes.b-cdn.net`**. Used as a dumb encrypted-blob pipe + installer host.
- **Anthropic API** via `lib/ai.ts` (raw fetch; default model `claude-sonnet-4-6`; degrades gracefully if `ANTHROPIC_API_KEY` absent).
- **PWA** (manifest, service worker, generated icons).

### Encryption / security model
- Classes encrypted with **AES-256-CBC** using the platform's **own key** (not Bunny's). CDN only ever holds ciphertext.
- Desktop app: atomic downloads (`.part` + size verification), decrypt → play in a **native player window** (`file://`), with a **moving per-student watermark** (name + email/phone) for traceability.
- Mac build is **Developer ID signed + notarized** (Developer ID **"Aldine Ventures Private Limited"**, Apple Team ID **`32W63QKXH8`**; notarytool + stapler, keychain profile **"ca-notary"**, hardened runtime, universal x64+arm64). Windows build is **NSIS x64, currently unsigned** (needs a Windows code-signing cert).

### Constraints / working agreements (must honor)
- **Never** have the founder paste passwords/secrets in chat. Secrets live in **Vercel env** or **local files** (e.g. `~/Desktop/notary.txt`, `~/Desktop/bunny.txt`) that are read locally and then deleted.
- The assistant **cannot** log in as the user or enter their credentials.
- **Never fabricate** student results/toppers — only use real data the founder provides.
- Secrets are **never committed** to git.
- **Graceful degradation** is the standard pattern for every paid integration (Razorpay, Mailgun, Interakt/WhatsApp, Anthropic, Telegram, Bunny): absent key → feature disabled cleanly, no crash.
- **Deploy preference:** ship completed phases by merging to `main` + pushing (Vercel auto-deploys); flag any manual migration steps.

---

## 3. Documents and Information Reviewed

- **`docs/HANDOVER.md`** (this file), **`docs/PROJECT_STATE.md`** (§24–§27 added: pricing, validity, desktop app, notifications), **`docs/DESKTOP_APP_PLAN.md`**.
- **Memory files** (`~/.claude/.../memory/`): `MEMORY.md` index, `deploy-preference.md`, `aldine-source-site.md`.
- **aldine.edu.in** — founder's existing CA site; catalog was **publicly crawled (WebFetch only)** and migrated into the new Supabase DB on **2026-06-14**. (Founder offered admin login; assistant **declined** — public fetch only.)
- **Supabase migrations** (see §6).
- **Bunny dashboard credentials** were provided by the founder in a local file (Access Key, read-only key, region endpoint) — used to upload installers; key file then deleted.
- **Apple notarization artifacts** — Developer ID cert created by founder; app-specific password stored in `notary.txt` (regenerated once after a 401).

Key observations:
- Aldine per-course prices differ widely → drove the **per-tier pricing** decision.
- 121caclasses.com **308-redirects to www** → broke desktop CORS until base URL was fixed to `https://www.121caclasses.com`.

---

## 4. Analysis Performed

- **Secure offline playback requires a native app**, not a browser (a browser can't hold a private decryption key safely or block trivial ripping). → Chose **Electron + own AES key + CDN-as-dumb-pipe**.
- **Bunny region:** advised **keeping Singapore** (closest low-latency region to India; a storage zone's region cannot be changed without recreating the zone; the CDN edge handles global delivery anyway). Rejected switching.
- **Pricing structure:** evaluated flat vs per-course vs per-tier. Chose **per-tier** (Gold per-subject, Silver flat, Bronze free) as it matched Aldine reality without over-complicating checkout.
- **Bulk notifications to 20k:** identified that true scale needs a **cron-drained queue** (not yet built); the current composer sends but large volume needs the queue + provider keys.
- **Desktop "Failed to fetch"** root-caused to the www redirect + CORS; fixed by pinning base URL to www.
- **BAD_DECRYPT** root-caused to a **truncated download** (network drop at 63.6%) treated as complete; fixed with **size verification** + atomic `.part`.
- **Notarize pre-check bug** in `@electron/notarize` (`codesign -dv --deep` returns 1, "host has no guest") → bypassed by `notarize:false` and **manual** notarytool + stapler.

---

## 5. Decisions, Conclusions, and Recommendations

### Decisions made
- Desktop app = **full website** + offline layer (not a single-class viewer).
- **Download button lives on each class** (plus a Downloads page); discussion shown **inline** under each class (YouTube-style), not behind a click-through.
- **Community board** added where the founder's pinned message is visible to all.
- Installers hosted on Bunny at stable URLs; website buttons read URLs from `site_settings`.
- Region stays **Singapore**.

### Recommendations / follow-up needing the founder or a professional
- Provide integration keys to fully activate features: **`ANTHROPIC_API_KEY`**, **`TELEGRAM_BOT_TOKEN`** (+ add bot as channel admin of @caparveen), **`MAILGUN_API_KEY`**, **`INTERAKT_API_KEY`**.
- Provide **real topper/result data** before any results UI goes live.
- Build the **cron-drained queue** before doing a real 20k email/WhatsApp blast.
- Consider **bulk student import** tooling.

---

## 6. Important Numbers, Dates, and References

### Dates
- **Today / key working date:** 2026-06-14 (Aldine migration, installer uploads, app cleanup all this date).

### URLs & identifiers
- Site: **121caclasses.com**, **www.121caclasses.com** (canonical; always use www for app/API).
- Supabase project: **`ydpkcmyjkekvfwnnvphn`**.
- Bunny storage zone: **`ca-classes`**; SG endpoint **`sg.storage.bunnycdn.com`**; CDN **`ca-classes.b-cdn.net`**.
- Telegram channel: **@caparveen** (env `TELEGRAM_CHANNEL_ID`, default `@caparveen`).
- Apple keychain notary profile: **`ca-notary`**; notarization email **`ra***@aldine.edu.in`**.

### Installer files (current, live, verified 2026-06-14)
- **Mac:** `https://ca-classes.b-cdn.net/CA-Classes-Mac-v2.dmg` — **178,355,930 bytes** (HTTP 200, size-matched).
- **Windows:** `https://ca-classes.b-cdn.net/CA-Classes-Windows-v2.exe` — **78,351,170 bytes** (HTTP 200, size-matched).
- `site_settings` keys **`app_url_mac`** and **`app_url_windows`** now point to these v2 URLs.

### Electron version / build
- electron **31.7.7**; mac target dmg arch **universal**; win target **nsis x64**.

### Supabase migrations (in `supabase/migrations/`)
- `0010_per_subject_gold_pricing.sql` — `subjects.gold_price_inr`, `subjects.validity_months`.
- `0011_protected_downloadable_classes.sql` — `protected_videos` table + `list_downloadable_classes()` + `get_protected_class_key()`.
- `0012_standalone_live_sessions.sql` — `live_sessions` (had to drop/recreate an empty legacy table that lacked `is_published`).
- `0013_downloadable_section_id.sql` — added `section_id` to `list_downloadable_classes`.
- `0014_community_board.sql` — `community_posts` + RLS (read all authenticated; insert/delete own; admin pin via service client).

### Pricing (as established)
- Gold: per-subject INR price (`gold_price_inr`) incl. bundle subjects; flexible validity options (e.g. **1 / 2 / 5 / 7 / 12 / 18 / custom** months).
- Silver: single flat price all subjects. Bronze: free.

---

## 7. Open Issues and Pending Questions

- **Missing integration keys** (blocking full activation): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `MAILGUN_API_KEY`, `INTERAKT_API_KEY`.
- **No real 20k-scale send path yet** — composer exists, but cron-drained queue is unbuilt; large blasts not safe yet.
- **No real topper/result data** — results features must wait for founder-supplied data.
- **Bulk student import** — not built.
- **Verification still useful:** confirm inline comments + community board render correctly **inside the desktop app** (offered, not fully verified on-device).
- **Trash item:** old `1to1 CA Classes 2.app` is in the macOS Trash (not yet emptied) — harmless.

### Risks / uncertainties
- Founder tends to run the app from the **DMG window** instead of /Applications → recurring "file in use / won't delete" problem. Mitigation = always drag to Applications, then eject DMG, run from Applications.
- The truncated-download class of bug is mitigated but depends on size metadata being correct at registration time.
- Notarization depends on the app-specific password staying valid; regenerate if a 401 recurs.

---

## 8. Action Items

### Immediate
- (Optional) Empty Trash to remove the old `1to1 CA Classes 2.app`.
- Founder: install v2 from the website, **drag to Applications, then eject DMG**, launch from Applications.
- Founder: supply the four integration keys when ready (assistant will place them in Vercel env).

### Medium-term
- Build the **cron-drained notification queue** for genuine 20k Email/WhatsApp/Telegram sends.
- Build **bulk student import**.
- Verify inline comments + community board look right inside the desktop app on Mac and Windows.
- Register additional encrypted classes (assistant can encrypt → upload to Bunny → register directly using the local key-file flow).

### Long-term
- Real results/toppers module once data exists.
- Expand AI tests (MCQ + subjective from transcripts) across the catalog; keep token-frugal / pre-generated.
- Scheduled live-class operations at scale.

---

## 9. Context for Future Conversations

- **Who you're talking to:** CA Parveen Sharma, non-technical founder. Give concrete, do-this-next guidance; you execute the technical parts.
- **Deploy:** push to `main` → Vercel auto-deploys. Always flag manual migration/DB steps.
- **Secrets discipline:** never ask for secrets in chat; read from local files (`~/Desktop/notary.txt`, `~/Desktop/bunny.txt`) then delete; never commit; never log in as the user.
- **Bunny uploads:** assistant CAN upload directly via `curl -T` PUT to `https://sg.storage.bunnycdn.com/ca-classes/<file>` with the `AccessKey` header read from the local key file (HTTP 201 = success). Verify public URL at `https://ca-classes.b-cdn.net/<file>`.
- **Desktop base URL must be `https://www.121caclasses.com`** (the apex 308-redirects and breaks CORS).
- **Encrypted class pipeline:** `scripts/encrypt-class.mjs` (AES-256-CBC) → `scripts/publish-class.mjs` (Bunny upload) → register row in `protected_videos` (with `section_id`) → student downloads via desktop app → decrypt → native player with watermark.
- **Key files/components:**
  - `lib/ai.ts` (`generateMcqs`, `generateSubjectiveQuestions`), `lib/notify.ts` (`telegramConfigured`, `sendTelegramChannel`), `lib/supabase/token.ts` (desktop auth: `tokenClient`, `bearer`, `corsHeaders`).
  - `app/api/app/classes/route.ts` + `app/api/app/license/route.ts` — Bearer-token desktop endpoints.
  - `desktop/main.js`, `desktop/preload.js` (`window.native = { isDesktopApp, download, isDownloaded, play, onProgress }`), `desktop/renderer/player.html`, `desktop/package.json`, `desktop/build/entitlements.mac.plist`.
  - `app/learn/topic/[topicId]/page.tsx` + `ClassDownload.tsx`, `app/learn/section/[sectionId]/DiscussionBoard.tsx` + `actions.ts` (note: a perl-edit once caused infinite recursion in `refresh()` — fixed to call `revalidatePath`).
  - `app/community/page.tsx` + `actions.ts`, `app/dashboard/page.tsx` (announcements), `app/page.tsx` ("Get the app" 5 buttons, live teaser, ICAI strip), PWA files (`app/manifest.ts`, `public/sw.js`, `app/install/*`, `app/help/page.tsx`, `app/components/RegisterSW.tsx`).
  - `app/admin/*` — protected classes, notifications, plans (Gold validity options via `setGoldValidityOptions`), live scheduler, mcq/subjective generators, decluttered courses/subjects/topics.
- **Backlog priority order (founder: "do all in order"):** (1) AI tests from transcripts, (2) live-class scheduling, (3) bulk notifications to 20k. (1) and (2) are built; (3) needs the queue + keys.

---

## Quick Reference Sheet (one page)

**Project:** 1:1 CA Classes — CA-coaching platform. Live: **www.121caclasses.com**.
**Founder:** CA Parveen Sharma (ps.smay@gmail.com) — non-technical; has Apple Developer acct; owns aldine.edu.in.
**Stack:** Next.js 14 + Supabase (`ydpkcmyjkekvfwnnvphn`) + Vercel (push `main` → deploy) + Electron desktop + Bunny CDN + PWA.

**Pricing:** Gold = per-subject + flexible validity (1/2/5/7/12/18/custom mo) · Silver = flat all-subjects · Bronze = free.

**Desktop app:** full website + encrypted offline download/play; AES-256-CBC own key; per-student moving watermark. Mac = Developer ID signed+notarized (profile `ca-notary`); Win = NSIS x64. **Base URL must be www** (apex breaks CORS).

**Live installers (verified 2026-06-14):**
- Mac: `https://ca-classes.b-cdn.net/CA-Classes-Mac-v2.dmg` (178,355,930 B)
- Win: `https://ca-classes.b-cdn.net/CA-Classes-Windows-v2.exe` (78,351,170 B)
- `site_settings.app_url_mac` / `app_url_windows` point here.

**Bunny:** zone `ca-classes`, SG endpoint `sg.storage.bunnycdn.com`, CDN `ca-classes.b-cdn.net`. Region stays Singapore. Assistant can upload via curl PUT (201=ok); key via local file, then delete.

**Telegram:** channel @caparveen (one post → all members).

**Rules:** never paste secrets in chat; secrets in Vercel env / local files then delete; never commit secrets; never log in as user; never fabricate results; graceful degradation for all paid integrations.

**Blocking inputs needed from founder:** `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN` (+ bot as channel admin), `MAILGUN_API_KEY`, `INTERAKT_API_KEY`, real topper data.

**Top next actions:** (1) collect integration keys → set in Vercel; (2) build cron-drained queue before real 20k blast; (3) verify comments/community in desktop app; (4) optional: empty Trash (old app). Install tip for founder: drag app to Applications, **then eject DMG**, run from Applications.

**Migrations:** 0010 per-subject Gold price; 0011 protected_videos + RPCs; 0012 live_sessions; 0013 section_id on downloadables; 0014 community_board.
