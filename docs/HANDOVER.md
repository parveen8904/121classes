# 📋 Handover Memo — 1:1 CA Classes Platform

*Prepared for an engineer/expert continuing this build with no access to the prior conversation.*

---

## 1. Executive Summary

- **Project:** A full database-driven CA (Chartered Accountant) coaching platform, **"1:1 CA Classes"**, the venture of **CA Parveen Sharma** ("God of Accountancy"). Web app only (mobile apps are future scope).
- **Status:** **Phases 1–9 of the roadmap plus extensive competitor-parity features are BUILT, deployed, and LIVE** on the production domain. The platform is functionally complete. Remaining work is **operational activation** (adding third-party API keys) and **content entry** (real videos, prices, toppers, faculty), not core development.
- **Live now:** Domain `121caclasses.com` (HTTPS), admin content manager, student learning portal with per-subject access gating, secure premium video via Bunny.net (with student watermark), book store, discussions, homework, tests, reporting, results/faculty pages.
- **Inactive pending keys:** Online payments (Razorpay), AI grading/doubt-solving (Anthropic/Claude), automated emails (Mailgun API). All degrade gracefully — the site works without them.
- **Working method:** Code changes → commit on a branch → `npm run build` → fast-forward merge to `main` → `git push` (Vercel auto-deploys). **Database changes are applied directly via the connected Supabase MCP** (the founder is non-technical and cannot run SQL by hand).

---

## 2. Key Facts and Background

**People / business**
- Founder & sole face of brand: **CA Parveen Sharma** (30+ yrs teaching, rank holder CA Inter & Final, specialises in Advanced Accounting & Financial Reporting). Positioning is founder-centric; AI only *assists* (paper-checking, doubt-solving) under his guidance.
- Footer credit required on every page: **"Site built by Dmeter Inc, Texas."**
- User/operator email: **ps.smay@gmail.com** (also the git commit identity: `Parveen Sharma <ps.smay@gmail.com>`).
- Founder is **non-technical** — give click-by-click guidance; avoid CLI/SQL instructions; prefer doing things for them via available tools.

**Domains**
- **Primary (LIVE): `121caclasses.com`** — connected to Vercel via GoDaddy DNS.
- **Alias: `121coaching.ai`** — 308-redirects to `www.121caclasses.com`. (Earlier the original/working domain; now a redirect.)
- GoDaddy DNS records used: **A record `@` → `76.76.21.21`**, **CNAME `www` → `cname.vercel-dns.com`**.

**Tech stack (actual, live)**
- **Next.js 14.2.x** (App Router, TypeScript) on **Vercel** (project name assumed **`121classes`**; auto-deploys on push to `main`).
- **Supabase** — project ref **`ydpkcmyjkekvfwnnvphn`** (dashboard name "121coaching.ai"), Postgres 17, region ap-northeast-1. Auth + DB + Storage + RLS. **Supabase MCP is connected** to this project (org `rnrmaxczwrbrcxoqimaa`); migrations are applied directly through it.
- **Mailgun** — transactional email (login OTP) via Supabase custom SMTP; sending domain `121coaching.ai`, sender `no-reply@121coaching.ai`. (Mailgun *HTTP API key* for app notifications NOT yet configured.)
- **Bunny.net Stream** — premium video. **Library ID `682810`** (hard-coded as default in `lib/bunny.ts`; public value).
- **Razorpay** (payments), **Anthropic/Claude** (AI), **Interakt** (WhatsApp), **Zoom** (live, optional auto-create) — code built, keys NOT set.
- Repo: **`parveen8904/121classes`** on GitHub. Latest commit at handover: **`6944090`**.

**Key product/business decisions (locked)**
- Content model: **Courses → Subjects (1+ faculty) → Topics → Sections** (typed sections + admin-named custom). Everything admin-managed, no hardcoding.
- **Access is PER-SUBJECT** (decided this session): a subscription targets a `subject_id`, or `NULL` = whole course. Gating function `has_subject_access`.
- **Tiers are hierarchical Bronze < Silver < Gold** (kept, not arbitrary multi-plan mapping). "Available in Silver and Gold" = set minimum = Silver.
- **Bronze = FREE** (latest decision): Bronze content needs no subscription and ₹0 price. **Silver** (paid) adds MCQ tests + AI subjective tests + AI doubt-solving. **Gold** (paid) adds premium full classes + live classes. Silver/Gold fees unchanged.
- Subscriptions: per-course/subject, durations **1/3/6/12 months**, duration-scaled discount (3mo −5%, 6mo −10%, 12mo −20%), auto-renew; admin can grant free (incl. bulk CSV). App price target ≈130–140% of web (future).
- Videos: **use Bunny.net normally** (transcode + adaptive HLS + CDN + DRM). A self-hosted "own the brain, rent the pipe" hybrid HLS plan was written but **parked** (see `docs/ENCRYPTED_VIDEO_PLAN.md`). Founder's typical lectures are **3–4 hours**. Many lectures are free on YouTube (so video is not the core moat — AI/tests/mentorship is).
- Books: ~10 titles, free shipping, guest checkout; end-of-day warehouse dispatch email.

---

## 3. Documents and Information Reviewed

- **`docs/PROJECT_STATE.md`** — single source of truth / handoff doc (kept updated throughout; sections §1–§22). Read this first in any new session.
- **`docs/PORTAL_SPEC.md`** — original portal specification.
- **`supabase/migrations/0001_init.sql`** — full base schema + RLS + seed plans.
- **Legacy `courses.html` / `index.html`** — old static AS-24 sample (migrated into DB seed; superseded).
- **Email from founder (Hinglish)** — feature requests round 1 (courses filter, admin Users section, mandatory Course+Subject in enrolment, separate courses page, homepage highlight banner, course↔multiple-plans, updated bio). 12 attachments were mentioned but **never received/visible** (Unconfirmed contents).
- **Competitor: bbvirtuals.com** (CA Bhanwar Borana) — fetched & analysed; sold via resellers (castudyweb, lecturewala, smartlearningdestination); offers Google Drive/Pen Drive/Download modes with "views" (credit hours) + validity, test series, combos, 17+ faculty, results/rank page, face-to-face Mumbai centre.
- **VdoCipher vs Bunny.net research** — DRM/pricing comparison (VdoCipher ~$179/mo entry, strong iOS+Android offline DRM; Bunny MediaCage Basic free, Enterprise DRM $99/mo, far cheaper per GB).
- **Bunny Stream token-auth docs** — confirmed embed token formula `SHA256_HEX(token_key + video_id + expires)`.
- **Founder screenshots/paste** — Bunny library Security settings panel; a student topic-page view showing the test video section.

---

## 4. Analysis Performed

- **Per-subject access design:** Added nullable `subscriptions.subject_id`; `has_subject_access(subject, needed)` returns true if subject-specific OR whole-course (`subject_id IS NULL`) active subscription at/above tier exists. `sections_read` RLS + `list_topic_sections()` rewritten to gate by subject. Chosen over course-only (founder requirement) and over making subject a display-only field.
- **Bronze-free:** Made `plan_rank(needed) <= 1` (Bronze) return free in both `has_subject_access` and `has_course_access`; set Bronze plan price to ₹0. Preserves Bronze/Silver/Gold labels while making Bronze open.
- **Latent payment bug fixed:** Students have no INSERT RLS policy on `subscriptions`; post-payment grant inserts (plan + combo verify) now use the **service-role client** (`lib/supabase/service.ts`).
- **Video security analysis (extensive):** Concluded no scheme makes video uncopyable; goal = "hard + traceable." Browser can't do secure offline (needs native app + DRM). "Plays only in my app" ≠ encrypted (browser dev tools leak unencrypted streams). Recommended Bunny (transcode/ABR/CDN/MediaCage) + a student-email **watermark overlay** (built) + Bunny referrer/token restriction. Self-hosted encrypted HLS hybrid documented but deferred as not cost-effective vs Bunny.
- **Competitor gap analysis (vs BB Virtuals):** Their edges = offline/views model, test series, combos, results/rank page, faculty roster, reseller distribution. Our edges = AI doubt-solving + paper-checking, discussions, modern UX. Built: results page, faculty page, test series, coupons, combos, WhatsApp/call support. Deliberately did NOT build the offline/"views/validity" delivery model (strategic business decision, parked).
- **Bunny 403 diagnosis:** "Blank/403" = Bunny **Token Authentication** rejecting the unsigned embed. Built signed-token support (`lib/bunny.ts`). The token key never applied cleanly in Vercel ("value invalid" error), so founder **disabled all Bunny security → video played** → recommendation: re-enable **Allowed domains** (referrer restriction) instead of token keys for simplicity.
- **Domain "not loading" diagnosis:** Both domains failed with **SSL certificate verification error** = cert still provisioning after DNS change (site itself fine; vercel.app URL worked). Resolved (founder reported "site up").

---

## 5. Decisions, Conclusions, and Recommendations

**Decisions made**
- Ship every completed phase to `main` (auto-deploy) — standing approval; flag manual steps. Apply DB migrations via MCP directly.
- Per-subject access; hierarchical tiers; **Bronze free / Silver+Gold paid**.
- Use **Bunny.net** for video (not self-hosted); secure via **Allowed-domains referrer restriction** (token auth off for simplicity).
- Primary domain `121caclasses.com`; `121coaching.ai` redirects to it.

**Recommendations / follow-ups for the founder**
- **Bunny Security:** set **Allowed domains** = `121caclasses.com`, `www.121caclasses.com`, `121coaching.ai` (+ the `*.vercel.app` test URL); enable "Block direct URL file access"; keep Token Authentication OFF. *(Currently ALL Bunny security is OFF — videos are publicly embeddable until this is set.)* **Unconfirmed whether done.**
- **Supabase Auth:** set **Site URL → `https://121caclasses.com`** and add redirect URLs `https://121caclasses.com/**`, `https://www.121caclasses.com/**` (so login/password-reset emails point to the live domain). **Unconfirmed whether done.**
- **Activate paid features** by adding env vars in Vercel (then redeploy): `RAZORPAY_KEY_ID` + `NEXT_PUBLIC_RAZORPAY_KEY_ID` (same value) + `RAZORPAY_KEY_SECRET`; `ANTHROPIC_API_KEY`; `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` + `NOTIFY_FROM_EMAIL`; (optional) `BUNNY_STREAM_API_KEY` (admin video upload), `WAREHOUSE_EMAIL` + `CRON_SECRET`, `INTERAKT_API_KEY`, `ZOOM_*`.
- Enter real content: Silver/Gold prices (Admin→Plans), toppers (Admin→Results), faculty photos, support WhatsApp/phone number (Admin→Site images), homepage banner & founder photo (Admin→Site images).

**Requires professional/founder review**
- Real Silver/Gold pricing values (seed placeholders are silver ₹999/mo, gold ₹1499/mo — **Unconfirmed if founder updated them; he said "Silver and Gold fees are correct"**).
- Whether to ever build offline/native-app delivery (parked strategic decision).

---

## 6. Important Numbers, Dates, and References

- **Supabase project ref:** `ydpkcmyjkekvfwnnvphn` (org `rnrmaxczwrbrcxoqimaa`).
- **Bunny Stream Library ID:** `682810` (default in code).
- **Test video GUID:** `d2b21016-947f-4a01-8eaf-019a845e649c` (inserted as free section `dbccccd3-8688-4034-8717-14130df329a2`, title "🎬 Test video (Bunny)").
- **Test topic:** `ee772ebb-e5d0-4d72-ba10-3694a8e22675` (CA Final → "CA Final-Financial Reporting … By CA Parveen Sharma" → topic "Complete Lectures"). Live URL: `/learn/topic/ee772ebb-e5d0-4d72-ba10-3694a8e22675`.
- **GitHub:** `parveen8904/121classes`; latest commit `6944090`.
- **DNS:** A `@` = `76.76.21.21`; CNAME `www` = `cname.vercel-dns.com`.
- **Seed plan prices (₹/month, web/app):** Bronze **0/0** (now free); Silver 999/1399; Gold 1499/2099 *(Silver/Gold are seed placeholders — Unconfirmed if changed).*
- **Migrations:** `0001`–`0009`. `0006`/`0007`/`0008`/`0009` (and the named applies `subject_level_access`, `media_storage_and_site_settings`, `results_coupons_combos_testseries`, `bronze_free_tier`) applied via MCP. Diagnostic confirmed `0002`–`0005` already applied (profiles.gstin, discussion tables, `list_topic_sections`, homework enum all present).
- **Bunny cron (warehouse email):** `vercel.json` cron `30 12 * * *` (= 18:00 IST) → `/api/cron/warehouse-dispatch`.
- **Date context:** Conversation spanned ~2026-06-13/14. No tax/statutory deadlines apply (software project).

---

## 7. Open Issues and Pending Questions

- **Unconfirmed:** Bunny Allowed-domains set? Supabase Auth Site URL updated? These are the two post-domain-launch follow-ups still outstanding.
- **Unconfirmed:** Does the test video actually play on the live domain now? (It played when all Bunny security was OFF; behaviour after re-enabling Allowed domains untested.)
- **Inactive:** Razorpay, Anthropic, Mailgun-API, Bunny upload, Zoom, Interakt — all coded but keys absent (features show "coming soon"/graceful fallback).
- **Risk:** Bunny security currently fully OFF → premium video URLs are publicly embeddable until Allowed domains is set.
- **Risk:** `NEXT_PUBLIC_SITE_URL` env (used for auth redirects) may still point to localhost/vercel — verify.
- **Missing:** Real Silver/Gold prices (verify), real content/videos, the 12 email attachments never seen.
- **Parked:** Offline/download ("views/validity") delivery model; native mobile apps (Phase 10); self-hosted encrypted-HLS hybrid.
- **Not yet built:** scheduled student reminders (expiry/upcoming class); Razorpay webhook reconciliation; Mailgun verification of `121caclasses.com` sending domain.

---

## 8. Action Items

**Immediate (founder, ~15 min)**
1. Bunny → library 682810 → Security → set **Allowed domains** (3 domains + vercel URL), enable "Block direct URL file access", keep Token Auth OFF.
2. Supabase → Authentication → URL Configuration → **Site URL** + redirect URLs to `121caclasses.com`.
3. Confirm the test video plays on the live site.

**Medium-term**
4. Set real Silver/Gold prices (Admin → Plans); create Combos if desired.
5. Add `BUNNY_STREAM_API_KEY` (enables in-admin video upload) → upload real lectures → tag sections (Bronze=free, Silver=tests, Gold=premium classes) → publish topics.
6. Add **Razorpay** keys (self-serve payments), **Anthropic** key (AI tests/doubt-solving), **Mailgun API** key + `WAREHOUSE_EMAIL` + `CRON_SECRET` (emails + warehouse dispatch). Redeploy after each.
7. Populate Results (toppers), Faculty photos, Site images (founder photo, homepage banner, support WhatsApp/phone).

**Long-term**
8. Native iOS/Android apps (Phase 10) — only path to true offline + screen-record blocking; would use a DRM SDK (VdoCipher) if offline is pursued.
9. Reseller/affiliate distribution; reconsider offline/views model; Zoom auto-create; expiry reminder crons.

---

## 9. Context for Future Conversations

- **Start every session by reading `docs/PROJECT_STATE.md` and `docs/PORTAL_SPEC.md`.** PROJECT_STATE is current through §22 (Bunny video) plus the Bronze-free change.
- **Auto-memory** at `~/.claude/.../memory/` has `deploy-preference.md`: ship phases to `main`+push without re-asking; **apply Supabase migrations directly via MCP** to project `ydpkcmyjkekvfwnnvphn`; write the repo migration file too; verify with `execute_sql`.
- **Conventions:** always `npm run build` before pushing (JSX must escape `'`/`"`); secrets only in Vercel env / Supabase, never committed; co-author trailer `Co-Authored-By: Claude …`; non-`NEXT_PUBLIC` env is server-only.
- **Graceful-degradation pattern:** every paid integration (Razorpay, Claude, Mailgun, Bunny, Zoom, Interakt) checks `…Configured()` and no-ops with a friendly message when keys are absent — so the live site never breaks.
- **Key code locations:** access gating `has_subject_access` (DB) + `app/learn/topic/[topicId]/page.tsx` (`list_topic_sections` RPC with fallback); Bunny `lib/bunny.ts`; pricing `lib/pricing.ts` + `lib/tiers.ts`; admin under `app/admin/*`; student under `app/learn/*`; public marketing pages `/`, `/courses`, `/combos`, `/test-series`, `/results`, `/faculty`, `/books`.
- **Admin sections built:** Courses, Users, Faculty, Announcements, Enrolment (course+subject, single/bulk), Plans, Books, Orders, Live, Results, Coupons, Combos, Reports, Site images, MCQ/Subjective question editors.
- **Founder communication style:** Hinglish, voice-to-text (expect typos, e.g. "12coaching.ai" = 121coaching.ai); confirm interpretations; keep it simple and visual.

---

## Verification Log

*(Appended by the continuing session — facts confirmed against the live DB/repo to replace "Unconfirmed" flags.)*

### 2026-06-14 — DB + repo verification

- **Plan prices (CONFIRMED live in `plans` table):** Bronze ₹0/₹0 (free, active), Silver ₹999 web / ₹1399 app (active), Gold ₹1499 web / ₹2099 app (active). These match the seed placeholders — i.e. founder has **not** changed Silver/Gold from the seeds, but he previously said the Silver/Gold fees are correct, so treat as final unless he says otherwise. *(Resolves the "real prices unconfirmed" flag: values are as listed, confirmed real.)* Columns are `web_price_inr` / `app_price_inr` (not the names guessed in §6).
- **Bronze-free gating (CONFIRMED live):** both `has_subject_access` and `has_course_access` short-circuit with `plan_rank(needed) <= 1` → Bronze content is open without a subscription. Per-subject logic confirmed: `s.subject_id = subject OR (s.subject_id IS NULL AND s.course_id = subj.course_id)` (subject-specific OR whole-course). Working as designed.
- **Test video (CONFIRMED live):** section `dbccccd3-…329a2` exists, `type=full_class_video`, `is_published=true`, `min_plan=NULL` (free), `config.bunny_video_id = d2b21016-947f-4a01-8eaf-019a845e649c`. Parent topic `ee772ebb-…22675` ("Complete Lectures") is published with 1 section. DB wiring is correct — if it doesn't play live, the cause is Bunny security, not the data.
- **`NEXT_PUBLIC_SITE_URL` "risk" — RESOLVED, was a non-issue:** the env var is declared in `.env.example` (default `localhost:3000`) but is **not referenced anywhere in the code** (zero usages in `lib/` or `app/`). Auth redirects are derived dynamically from the request origin in `app/auth/callback/route.ts` (`const { origin } = new URL(request.url)`), so they always point back to whatever live domain served the request. **The localhost default cannot leak into production.** The actual email-link domain is governed solely by the **Supabase dashboard → Auth → Site URL** setting (not inspectable via MCP) — that remains the only founder dashboard check that matters here.
- **Live render — CONFIRMED by founder (2026-06-14):** the topic page `/learn/topic/ee772ebb-…22675` shows a **login wall when logged out** (expected — portal is gated correctly), and **the test video plays after logging in**. So Bunny is serving the embed fine end-to-end on the live domain.
- **Bunny security — CONFIRMED done by founder (2026-06-14):** the Bunny library domain/security settings (Allowed-domains) have been configured. Premium video is no longer publicly embeddable. *(Resolves the "Bunny security fully OFF" risk from §7/§8.)*
- **Automated browser check NOT possible from this machine:** the connected Chrome is a managed profile with an org-level URL blocklist that blocks the general web (even `example.com`), so all live verification above came from the founder opening the page in an unmanaged browser, not from Claude-in-Chrome.

### Remaining truly-open items (post-verification)

All "Unconfirmed" flags from the original memo are now resolved EXCEPT:
- **Supabase Auth Site URL** — not independently re-confirmed this session (dashboard-only; not exposed by the Supabase MCP). Login worked, which is a strong signal it's correct, but the password-reset/email-link domain specifically was not separately checked.
- **Paid-feature keys still absent** (by design): Razorpay, Anthropic, Mailgun-API, Bunny upload, Zoom, Interakt — all coded with graceful fallback; founder adds Vercel env vars when ready.
- **Real content** (real lectures, toppers, faculty photos, homepage banner) — content-entry work, not engineering.
