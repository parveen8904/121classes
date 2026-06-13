# 1:1 CA Classes — Project State & Handoff

**Purpose:** single source of truth to resume work in a fresh chat.
**Last updated:** 2026-06-09

> In a new chat, say: **"Read docs/PROJECT_STATE.md and docs/PORTAL_SPEC.md, then continue."**

---

## 1. Project at a glance
- **Brand (display):** **1:1 CA Classes** · **Primary domain:** `121caclasses.com` (`121coaching.ai` is a live **alias** for the same site — still resolves, not abandoned)
- **Founder / face of brand:** **CA Parveen Sharma** (renowned CA faculty). The whole venture is his; the landing page is founder-centric.
- **Positioning:** highly personalized · AI-enabled (AI *assists* only) · clears the clutter · top-notch · result-oriented.
- **AI stance:** Teaching is 100% CA Parveen Sharma & team. **AI only assists** with **paper checking** and **doubt-solving**, under his guidance.
- **Repo:** `parveen8904/121classes` · working branch `claude/landing-page-text-fix-C0lDT`, merged to `main`.
- **Footer credit:** "Site built by Dmeter Inc, Texas."

---

## 2. Tech stack (ACTUAL — what is live now)
| Layer | Choice | Status |
|---|---|---|
| App framework | **Next.js 14.2.x** (App Router, TypeScript) | Live |
| Hosting | **Vercel** (project currently named `121classes`) | Live (auto-deploys on push to `main`) |
| Auth + DB + Storage | **Supabase** (project ref `ydpkcmyjkekvfwnnvphn`) | Live |
| Transactional email | **Mailgun** SMTP via Supabase custom SMTP | Live (sending domain `121coaching.ai`, sender `no-reply@121coaching.ai`) |
| Video (planned) | **Bunny.net** (ad-free streaming) | Not built yet |
| Live classes (planned) | **Zoom Webinar** | Not built yet |
| Payments (planned) | **Razorpay** | Not built yet |
| Notifications (planned) | **WhatsApp Business API via Interakt** + email | Not built yet |
| AI (planned) | **Claude API** (paper checking + doubt-solving) | Not built yet |
| Mobile apps (planned) | **React Native / Expo** (web-first, apps later) | Not built yet |

> NOTE: AWS was considered then **dropped**. `docs/AWS_COST_AND_SETUP.md` is **superseded** (kept for history). Cost/infra reference is `docs/INFRA_AND_COST.md`.

---

## 3. What is BUILT and LIVE
**Phase 1 (Foundation) — complete:**
- Email **one-time code** login (6-digit via Mailgun), **phone OTP** login (needs an SMS provider configured to actually send), and **email + password** login.
- **"Keep me logged in on this device"** (sessions persist by default).
- **Forgot/Set password:** reset page at `/auth/reset`; users can also set a password from the dashboard.
- **Email confirmation is OFF** in Supabase (the OTP code itself verifies the email).
- **Student dashboard** (`/dashboard`) and **admin panel shell** (`/admin`, role-gated).
- Full **database schema + RLS** applied (see §6).

**Marketing landing page — built (placeholder content, editable):**
- Hero (flashing "A venture by CA Parveen Sharma" ribbon; founder name in a solid teal chip).
- Mentor section (CA Parveen Sharma — photo slot, bio, stats, photo gallery slots).
- "Faculty-led, AI-assisted" section clarifying AI only assists.
- Studio + intro video (currently a sample HeyGen embed).
- Courses (credited to "CA Parveen Sharma & his team"), Books, What's New, Resources, Testimonials, About, Vision, Contact.
- **Privacy** (`/privacy`) and **Refund** (`/refund`) policy pages (placeholder legal text).
- **Dark/light theme toggle** (no-flash; teal-charcoal dark base + light base; shared teal/emerald accents).
- **Announcement splash** popup on landing: shows **once per visit**, stays **10 seconds**, dismissible.
- **Logo:** bold text wordmark — **"1:1"** in a teal/emerald pill + **"CA Classes"**.

---

## 4. Repo structure
```
app/
  layout.tsx              Root layout + no-flash theme script
  globals.css             All styles (theme vars, landing, components)
  page.tsx                Landing page (marketing)
  login/page.tsx + login-form.tsx     OTP + password + remember-me
  auth/callback/route.ts  Email-link/code session exchange
  auth/reset/page.tsx + reset-form.tsx  Password reset
  dashboard/page.tsx + sign-out.tsx + set-password.tsx
  admin/page.tsx          Admin shell (role-gated)
  components/             SiteNav, SiteFooter, Logo, ThemeToggle, AnnouncementSplash
lib/supabase/             client.ts (browser), server.ts (SSR cookies)
middleware.ts             Session refresh + guards /dashboard,/admin
supabase/migrations/0001_init.sql   Full schema + RLS + seed plans
public/brand/             README + (place real photos here)
docs/                     PORTAL_SPEC.md, INFRA_AND_COST.md, PHASE1_SETUP.md,
                          AWS_COST_AND_SETUP.md (superseded), PROJECT_STATE.md (this)
index.html, courses.html  LEGACY static pages (superseded by the Next app on the live site)
```

---

## 5. Auth & accounts (where things live)
- **Supabase project ref:** `ydpkcmyjkekvfwnnvphn` (URL `https://ydpkcmyjkekvfwnnvphn.supabase.co`).
- **Env vars (in Vercel):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase **publishable** key `sb_publishable_…`), `SUPABASE_SERVICE_ROLE_KEY` (Supabase **secret** key `sb_secret_…`). Local: `.env.local` (see `.env.example`).
- **Supabase Auth settings:** Email confirmation OFF; Magic Link email template edited to show the code `{{ .Token }}`; Email OTP length set to 6; custom SMTP = Mailgun.
- **Mailgun:** sending domain `121coaching.ai`, SMTP user `no-reply@121coaching.ai`, host `smtp.mailgun.org`, port 587. (Sandbox/authorized-recipient caveat may apply until the domain is fully verified.)
- **Admin access:** set a user's `profiles.role = 'admin'` (Supabase Table Editor or SQL) to unlock `/admin`.

---

## 6. Database schema (Supabase Postgres, file: supabase/migrations/0001_init.sql)
RLS is **enabled on every table**. The script is transactional and re-runnable (drops + recreates).

**Enums:** `user_role(student,admin,faculty)`, `plan_tier(bronze,silver,gold)`,
`section_type(ask_doubt,revision_video,full_class_video,live_class,pdf,mcq_test,subjective_test,past_papers,rich_text,custom)`,
`sub_status(active,expired,cancelled)`, `sub_channel(web,ios,android,admin_grant)`,
`order_kind(subscription,book)`, `book_order_status(paid,dispatched,delivered,cancelled)`,
`announcement_kind(amendment,whats_new,student_corner,industry,macro)`, `notif_channel(whatsapp,email)`.

**Tables:**
- `profiles` (id→auth.users, full_name, email, phone, role, target_attempt, created_at) — auto-created by trigger `handle_new_user` on signup.
- `courses` (id, title, slug, order_index, is_published)
- `subjects` (id, course_id→courses, title, slug, order_index)
- `faculties` (id, full_name, photo_url, bio)
- `subject_faculty` (subject_id, faculty_id) — many-to-many (a subject can have multiple faculty)
- `topics` (id, subject_id→subjects, title, slug, order_index, valid_from_attempt, valid_to_attempt, amendments_upto, is_published)
- `sections` (id, topic_id→topics, type[section_type], title, order_index, min_plan[plan_tier|null=free], config jsonb, is_published) — supports admin-named **custom** sections; `config` holds type-specific data (e.g. bunny/youtube ids, pdf path)
- `mcq_questions` (id, section_id, question, options jsonb, correct_index, order_index)
- `mcq_attempts` (id, student_id, section_id, score, total, answers jsonb, created_at)
- `subjective_questions` (id, section_id, prompt, max_marks)
- `subjective_submissions` (id, student_id, question_id, answer_text, ai_score, ai_feedback, status, created_at)
- `plans` (id, tier, name, rank, web_price_inr, app_price_inr, features jsonb, is_active) — **seeded** with Bronze/Silver/Gold (placeholder prices)
- `subscriptions` (id, student_id, course_id, plan_id, channel, starts_at, ends_at, status, auto_renew, granted_by_admin_id, created_at) — **per-course, time-bound**
- `orders` (id, student_id, kind[subscription|book], ref_id, channel, razorpay_order_id, store_txn_id, amount_inr, status, created_at)
- `books` (id, title, author, description, cover_url, price_inr, stock_qty, is_active)
- `book_orders` (id, student_id, guest_contact jsonb, items jsonb, amount_inr, razorpay_order_id, ship_to jsonb, status, warehouse_notified_at, created_at)
- `live_sessions` (id, section_id, zoom_webinar_id, starts_at, join_url, recording_bunny_id)
- `notifications` (id, student_id, channel, template, payload jsonb, status, sent_at)
- `announcements` (id, kind[announcement_kind], title, body, link_url, published_at, is_published)
- `doubts` (id, student_id, section_id, question, ai_answer, status, created_at)

**Helper functions:** `is_admin()`, `plan_rank(plan_tier)`, `has_course_access(course uuid, needed plan_tier)`.
**RLS model:** public read of published catalogue (courses/subjects/topics/faculties/books/announcements/plans); `sections` readable if free OR the user has an active subscription to the topic's course at/above `min_plan`; students see only their own attempts/submissions/orders/subscriptions/doubts; admins manage everything.

---

## 7. Business model (DECIDED — see docs/PORTAL_SPEC.md for full detail)
- **Content:** Courses → Subjects (1+ faculty each) → Topics → Sections (built-in types + **admin-created custom sections**).
- **Subscriptions:** **per course**, durations **1 / 3 / 6 / 12 months**; student **builds own plan** (course × tier × duration); pricing **scales with duration** (longer = discount); **auto-renew until cancelled**. **Admins can manually enrol (incl. bulk CSV) and grant any course/tier/duration for free.**
- **Tiers:** **Bronze** (revision videos + PDFs), **Silver** (+ Ask Doubts + Subjective tests), **Gold** (everything incl. full class videos + live classes). Admin-configurable.
- **Pricing:** web via **Razorpay**; **app prices ≈ 130–140% of web** (store billing), clearly disclosed.
- **Exam-attempt filtering:** content tagged by validity window / amendments-upto; students see only what's valid for their `target_attempt`.
- **Videos:** self-recorded by faculty; **Bunny.net** ad-free streaming; English audio track; optional public YouTube copy for marketing.
- **Live classes:** **Zoom Webinar**; recordings attached back to the topic.
- **Books:** ~10 titles, **free shipping**, **guest checkout**; warehouse gets an **end-of-day dispatch email**.
- **Notifications:** **WhatsApp (Interakt)** + email on enrolment & key events.
- **AI:** paper checking + doubt-solving via Claude, **under CA Parveen Sharma's guidance**.

---

## 8. Outstanding / TODO
- [ ] Upload founder/student/studio **photos** to `public/brand/` → wire `<img>` into the slots.
- [ ] Provide a **YouTube link** for the homepage intro video (replace sample embed).
- [x] **Domain LIVE:** `121caclasses.com` is connected in Vercel (GoDaddy A `@`→76.76.21.21, CNAME `www`→cname.vercel-dns.com); `121coaching.ai` 308-redirects to `www.121caclasses.com`. SSL issued.
  - [ ] Follow-ups: update Supabase Auth **Site URL** → `https://121caclasses.com` + redirect URLs; add the real domains to **Bunny allowed domains** (lib 682810).
- [ ] (Optional) Mailgun: verify `121caclasses.com` so email comes from `@121caclasses.com`.
- [ ] (Optional) Enable **single session per user** (Supabase → Authentication → Sessions; may need Pro).
- [ ] Replace placeholder copy (testimonials, stats, course/book details, announcement text, legal pages) with real content.

---

## 9. Phased roadmap (remaining)
1. ✅ **Phase 1 — Foundation** (auth, schema, dashboards) — DONE.
2. ✅ **Phase 2 — Admin content manager** — DONE. Full CRUD admin UI (see §11): Course→Subject→Topic→Section (type-aware section config incl. custom sections), faculty + subject assignment, announcements. RLS-driven (admin cookie passes `is_admin()`; no service-role key used).
3. ✅ **Phase 3 — Student portal** — DONE (see §12). Renders subjects → attempt-filtered topics → gated sections at `/learn`. AS 24 sample migrated to DB seed. **Requires running `supabase/migrations/0002_phase3.sql` once in Supabase.**
4. ✅ **Phase 4 — Subscriptions & admin enrolment** — DONE (see §13). Admin single/bulk grants, revoke/extend; plan price editor; student access status + cancel auto-renew. **Requires `supabase/migrations/0003_phase4.sql`.**
5. 🟡 **Phase 5 — Payments & book store** — built (see §15). Razorpay checkout for **plans** and **books** (guest checkout), admin book catalogue + order fulfilment. **Activates when Razorpay keys are added to Vercel env** (degrades to "contact us" until then). Remaining: automated end-of-day warehouse email.
6. 🟡 **Phase 6 — Live classes + messaging** — built (see §16). Live-class scheduling + student/admin live views work now (manual links). Email/WhatsApp notifications **activate when keys are added** (Mailgun API / Interakt).
7. 🟡 **Phase 7 — Tests + AI** — built (see §17). MCQ auto-grading works now; AI subjective grading + doubt-solving **activate with `ANTHROPIC_API_KEY`** (fall back to faculty review until then).
8. 🟡 **Phase 8 — Reporting & warehouse** — built (see §18). Reports dashboard works now; the daily warehouse dispatch email **activates with Mailgun + WAREHOUSE_EMAIL**.
9. ✅ **Phase 9 — Landing "What's new" from DB** — the homepage now renders published `announcements` (newest 6) in the What's New section, falling back to placeholders when empty. Manage at `/admin/announcements`. **Plus Zoom auto-create** (see §16).
10. **Phase 10 — Mobile apps** (Expo iOS + Android; store billing).

---

## 10. Admin content manager (Phase 2 — built)
Role-gated under `/admin` (layout guards `profiles.role = 'admin'`). All writes are
**Server Actions** using the cookie-based Supabase client; RLS `is_admin()` authorises them.
- `/admin` — hub linking to the live managers (Plans/Enrolment/Live/Books/Reporting still phase-tagged).
- `/admin/courses` — list + create courses; publish toggle + delete.
- `/admin/courses/[courseId]` — edit course; add/delete **subjects**.
- `/admin/subjects/[subjectId]` — edit subject; assign **faculty** (many-to-many); add/publish/delete **topics** (incl. attempt-validity fields).
- `/admin/topics/[topicId]` — add/edit/publish/delete **sections** via a **type-aware form** (`SectionForm`); config stored in `sections.config` jsonb. Section types + their fields live in `app/admin/topics/[topicId]/sectionTypes.ts`.
- `/admin/faculty` — CRUD faculty (name, photo URL, bio).
- `/admin/announcements` — CRUD announcements (kind, title, body, link, published).
- Shared bits: `app/admin/_lib/util.ts` (slugify/str/num/nullable), `app/admin/_components/` (DeleteButton, PublishToggle).
- Section config conventions: videos → `bunny_video_id` (+ optional `youtube_url`); revision_video adds `revision_round` (First/Second); pdf/past_papers → `pdf_url`; rich_text → `body`; live_class → `zoom_webinar_id`/`join_url`/`starts_at`; ask_doubt/mcq_test/subjective_test → no config (questions added in Phase 7).

---

## 12. Student portal (Phase 3 — built)
Logged-in students browse content under `/learn` (middleware guards it; redirects to `/login`).
- `/learn/[courseId]` — subjects (with assigned faculty) → topics, **filtered by the student's `target_attempt`** (helper `app/learn/_lib/attempt.ts`; unset target shows all; unparseable bounds are permissive). Reached from dashboard course cards.
- `/learn/topic/[topicId]` — renders sections **in order with plan gating**:
  - Metadata for *all* published sections (incl. locked) comes from RPC **`list_topic_sections(topic)`** (SECURITY DEFINER, returns no `config`, computes an `unlocked` flag via `has_course_access`).
  - The protected `config` (video ids / pdf urls) is fetched from the `sections` table under normal RLS — so it only returns for **unlocked** sections. Locked ones show a 🔒 + “Unlock with <plan>” prompt; no content leaks.
  - Per-type rendering (`SectionBody`): video (`embed_url` → YouTube via `app/learn/_lib/media.ts`; Bunny later), pdf/past_papers (download button), rich_text, live_class, ask_doubt (disabled box, AI in Phase 7), mcq/subjective (placeholder, Phase 7).
- **DB migration `supabase/migrations/0002_phase3.sql`** adds `list_topic_sections()` and seeds the **AS 24** sample (CA Intermediate → Accounting → AS 24 → 9 sections; Main Revision is free, others Bronze/Silver). **Run it once in Supabase SQL Editor.**
- Admin section editor gained an **`embed_url`** config field (used by the HeyGen sample).

---

## 13. Subscriptions & enrolment (Phase 4 — built)
No payment yet (that's Phase 5) — access is granted by admins, and this is what unlocks the Phase 3 gated sections.
- **Pricing model** `lib/pricing.ts`: `web_price_inr` is a **per-month base**; total = base × months × (1 − duration discount). Discounts: 3mo −5%, 6mo −10%, 12mo −20%. Durations 1/3/6/12. `formatINR`, `durationLabel` helpers.
- **`/admin/enrolment`** — grant a subscription **free** (channel `admin_grant`): single (by email) or **bulk** (paste CSV/list of emails; reports which had no account). Lists recent subscriptions with **Extend** (+1/3/6/12mo) and **Revoke** (status→cancelled). Looks up students via `profiles` (admin RLS); resolves tier→plan row; computes `ends_at`.
- **`/admin/plans`** — edit each tier's name, **per-month web & app price**, active flag; shows a live duration-total preview.
- **Student access** (on `/learn/[courseId]`): a polished hero + an **access banner** — when subscribed shows the active plan/expiry/auto-renew with a cancel button; when not, a **“View plans →”** CTA. No inline price grid (by design).
- **Dedicated plans page `/learn/[courseId]/plans`** — professional pricing cards (Bronze/Silver/Gold) with a **duration toggle** (1/3/6/12mo, live price + savings), tier feature lists (`lib/tiers.ts`), Silver flagged "Most popular", current-plan highlighting; "Get <tier>" → `/#contact` until checkout (Phase 5).
- **Upgrade-at-the-lock:** locked sections on the topic page show a 🔒 badge + an inline **Upgrade →** button that deep-links to the course's plans page (richer section cards with per-type icons via `app/globals.css` `.sec-card`/`.lock-row`/`.plan-card`).
- **Student self-service RPC** `set_my_auto_renew(sub, on)` (SECURITY DEFINER, ownership-checked) — avoids a broad student UPDATE policy on `subscriptions` (which would let them tamper with `ends_at`/`plan_id`). Admin grants/revoke/extend use the existing `subsr_admin` RLS.
- **DB migration `supabase/migrations/0003_phase4.sql`** — adds the RPC. **Run once in Supabase SQL Editor.**
- Admin hub now links **Enrolment** and **Plans** (live); Live/Books/Reporting still phase-tagged.

---

## 14. Discussion boards, profile, new section types (built)
**Requires `supabase/migrations/0004_discussion_profile.sql` (run once).** Adds enum values, profile columns, and the discussion tables.
- **Resilience fix:** `/learn/topic/[topicId]` now falls back to a direct RLS-filtered `sections` query when `list_topic_sections()` isn't deployed — so published sections always render (was the cause of "published sections not showing").
- **Topic form simplified:** only an optional **"Applies from attempt"** (`valid_from_attempt`); end is always open-ended. `valid_to_attempt`/`amendments_upto` no longer asked (kept nullable in DB).
- **New section types:** `discussion_video` (plays like a video), `discussion` (a Q&A board — config `body`), and `homework` (config `body` + `pdf_url`; **requires `0005_homework.sql`**).
- **Shared portal chrome:** every signed-in page (student + admin) now uses `app/components/PortalHeader.tsx` + `PortalFooter.tsx` via route layouts (`app/dashboard/layout.tsx`, `app/learn/layout.tsx`, and the admin layout). Two-colour brand strip, an inspirational line, emoji nav, theme toggle, sign-out; admin layout adds an emoji sub-nav. Inline `.topbar` headers were removed from the individual pages. Emoji sprinkled across headings/empty states for a friendlier feel.
- **Discussion board** `/learn/section/[sectionId]`: students post **threads**; staff + students **reply**; staff replies can attach a **solution PDF URL** and a **video reference** (free text like "Video 7 @ 12:30"); admin can **mark solution**, **mark resolved**, and **delete** (moderation). Tables `discussion_threads` / `discussion_posts` with RLS (read = any signed-in; write = author; moderate = author or admin). Reached from a `discussion` section's "Open discussion board →".
- **Student profile** `/dashboard/profile`: full name, phone, target attempt, **shipping address** (line1/2, city, state, pincode) and optional **GST** (GSTIN + business name) — for book delivery & GST invoices. Saved via `profiles_self_update` RLS. Linked from the dashboard header.

---

## 15. Payments & book store (Phase 5 — built, needs keys)
**No DB migration.** Everything degrades gracefully when Razorpay isn't configured (`razorpayConfigured()` false → UI shows "contact us / coming soon"; manual enrolment unaffected).
- **Env vars (add in Vercel to activate):** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` (id == public id). Test keys (`rzp_test_…`) first. `SUPABASE_SERVICE_ROLE_KEY` already set (used for guest book orders).
- **`lib/razorpay.ts`:** server-only create order / fetch order / HMAC signature verify. Source of truth for a purchase is the **Razorpay order `notes`** (set at create, re-read at verify) — the client can't tamper with course/tier/amount.
- **Plan checkout:** `app/learn/[courseId]/plans/PricingCards.tsx` opens Razorpay (loads checkout.js) → `payActions.ts` `createPlanOrder` / `verifyPlanPayment` → on success inserts a `web` subscription (auto_renew on) + marks the `orders` row paid. Falls back to `/#contact` when unconfigured.
- **Book store:** public `/books` (active catalogue) + `/books/[id]` detail with **guest checkout** (`BookCheckout.tsx` + `payActions.ts`). Verified payment inserts a `book_orders` row via the **service-role client** (`lib/supabase/service.ts`, bypasses RLS since guests have no cookie) and decrements stock.
- **Admin:** `/admin/books` (catalogue CRUD: price, stock, cover, active) and `/admin/orders` (paid book orders with delivery details → mark dispatched/delivered). Hub + sub-nav updated; landing "Books" and portal header link to `/books`.
- **TODO:** automated end-of-day warehouse dispatch email (needs Mailgun API key + a Vercel cron hitting a protected route); Razorpay webhook for out-of-band capture reconciliation.

---

## 16. Live classes & messaging (Phase 6 — built)
**No DB migration.** Live classes ride on the existing `live_class` section type + config; notifications use the existing `notifications` table.
- **Live classes (works now, no external account):** the `live_class` section config gained `recording_url`, and `starts_at` is now a datetime picker. Admin **`/admin/live`** lists every live-class section across all courses with inline scheduling (start time, Zoom/Meet join link, recording link). Student **`/live`** shows upcoming (with Join) and past (with Watch recording) sessions across their accessible courses (RLS-gated). Topic page renders join + recording + formatted time. Linked from portal header (📡 Live) and admin sub-nav/hub.
- **Messaging (`lib/notify.ts`, graceful):** `sendEmail` via **Mailgun HTTP API**, `sendWhatsApp` via **Interakt** (both no-op + logged "skipped" when unconfigured). `notifyByEmail` logs to `notifications` via the service client. Branded `emailShell` wrapper.
- **Wired events (send confirmation email + log):** admin enrolment **grant** (single + bulk), **plan purchase** (verifyPlanPayment), **book order** (verifyBookPayment).
- **Env to activate email:** `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `NOTIFY_FROM_EMAIL`. WhatsApp: `INTERAKT_API_KEY` (needs approved templates).
- **Zoom auto-create (`lib/zoom.ts`, optional):** Server-to-Server OAuth → "🎥 Auto-create Zoom link" button on `/admin/live` (shown only when `ZOOM_ACCOUNT_ID`/`ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` are set) creates a scheduled meeting from the section title + start time and stores `join_url` + `zoom_webinar_id`. Falls back to manual paste when unconfigured.
- **Not yet:** scheduled student reminders (expiry/upcoming-class); native apps (Phase 10).

---

## 17. Tests & AI (Phase 7 — built)
**No DB migration** (uses existing `mcq_questions`/`mcq_attempts`/`subjective_questions`/`subjective_submissions`/`doubts`).
- **Section route is now a dispatcher:** `app/learn/section/[sectionId]/page.tsx` loads the section (RLS-gated) and renders `McqSection`, `SubjectiveSection`, or `DiscussionSection` by `type`; other types redirect to the topic.
- **MCQ (works now, no AI):** admin `/admin/mcq/[sectionId]` (add questions: 4 options + correct radio, stored in `mcq_questions.options` jsonb). Student `McqForm` submits to `gradeMcqAttempt` (server) which fetches `correct_index` **server-side only** (never sent to browser), scores, and writes `mcq_attempts`.
- **Subjective (AI paper-checking):** admin `/admin/subjective/[sectionId]` (prompt + max_marks). Student `SubjectiveForm` → `submitSubjective`: if AI configured, `gradeSubjective` returns `{score, feedback}` (status `graded`); else status `submitted` with a faculty-review message. Writes `subjective_submissions`.
- **AI doubt-solving:** `ask_doubt` sections render `DoubtBox` inline on the topic page → `askDoubt` → `answerDoubt` (Claude) or "faculty will review" fallback; logged to `doubts`.
- **`lib/ai.ts`:** Anthropic Messages API via fetch, model `claude-sonnet-4-6` (override `ANTHROPIC_MODEL`); `answerDoubt`, `gradeSubjective`, `aiConfigured`. **Env:** `ANTHROPIC_API_KEY`.
- Test editors linked from the topic editor section rows; tests opened from the student topic page ("Start test →").

---

## 18. Reporting & warehouse (Phase 8 — built)
**No DB migration.**
- **`/admin/reports`:** live KPIs (total & this-month revenue, active subscriptions, students, book orders, awaiting dispatch), revenue split (subscriptions vs books), active plans by tier, top-selling books. Revenue = **paid online orders** (`orders` kind=subscription status=paid + non-cancelled `book_orders`); admin-granted free enrolments don't count. Sums computed in JS (fine at current scale; swap to an RPC if volume grows).
- **Warehouse dispatch email** (`lib/warehouse.ts` `runWarehouseDispatch()`): emails the warehouse all **paid + not-yet-`warehouse_notified_at`** book orders (items + ship-to table), then stamps them. Idempotent.
  - **Cron:** `app/api/cron/warehouse-dispatch/route.ts` + `vercel.json` cron `30 12 * * *` (18:00 IST). Secured by `CRON_SECRET` (Vercel sends it as Bearer; `?secret=` also accepted for manual hits).
  - **Manual:** `/admin/orders` has an "📧 Email dispatch list to warehouse" button (server action → same helper).
  - **Env:** `WAREHOUSE_EMAIL`, `CRON_SECRET` (+ Mailgun from Phase 6).
- Admin hub + sub-nav gained **📊 Reports**.

---

## 19. Founder feedback — round 1 (built)
- **Admin Users** `/admin/users` (+ `[id]`): search/filter all profiles by name/email/phone & role; view/edit any profile (name, phone, attempt, **role**, address, GST) and see their subscriptions. Linked in admin header sub-nav + hub.
- **Courses filter:** `/admin/courses` has search (title/slug) + status (published/draft).
- **Public Courses page** `/courses` (SiteNav/Footer layout): all published courses with subjects + faculty. Homepage Courses section now pulls newest 3 from DB with an "Explore all courses →" CTA; nav "Courses" → `/courses`.
- **Homepage highlight banner:** slim banner under the hero showing the latest announcement (links to it / #whats-new).
- **Bio update:** mentor section rewritten with the "God of Accountancy" / 30+ yrs / rank-holder / Advanced Accounting & FR copy.
- **Still pending decisions (asked):** subject-level enrolment (Course+Subject mandatory) and course↔multiple-plan mapping — both touch the access model.

---

## 20. Image uploads (built)
**Migration 0007** (applied via MCP): public **`media`** storage bucket (admin-only write, public read) + **`site_settings`** key/value table.
- **`ImageUpload` component** (`app/admin/_components/ImageUpload.tsx`): uploads to the `media` bucket via the browser client, shows a preview, also accepts a pasted URL; carries the result in a named field for the surrounding server-action form.
- Wired into **Faculty** (photo) and **Books** (cover) admin forms.
- **`/admin/site`** ("🖼️ Site images"): upload **founder photo** + **homepage banner** → stored in `site_settings` → rendered on the landing page (mentor photo, hero banner). Linked in admin hub + sub-nav.
- Uploads are admin-only (storage RLS uses `is_admin()`); images are world-readable.

---

## 21. Competitive features (built — vs BB Virtuals)
**Migration 0008** (via MCP): `courses.is_test_series`, `results`, `coupons`, `combos`/`combo_items`.
- **Results / rank-holders:** admin `/admin/results` (CRUD + photo upload); public `/results`; homepage toppers strip. Biggest trust lever.
- **Public Faculty page** `/faculty` (from `faculties` table). **Public Courses** `/courses` already existed; nav now has Courses/Combos/Test Series/Results/Faculty/Books.
- **WhatsApp + Call support:** `FloatingSupport` (bottom-right) on every page via root layout; numbers set in `/admin/site` (`support_whatsapp`, `support_phone` in `site_settings`). Root layout is now `force-dynamic`.
- **Test Series:** `is_test_series` flag on a course (admin toggle); public `/test-series`; excluded from `/courses` + homepage.
- **Coupons:** admin `/admin/coupons`; `lib/coupons.ts` `applyCoupon`/`redeemCoupon` (service-role, server-only); applied at plan checkout (coupon field in `PricingCards`, discount in `createPlanOrder`, redeem in verify).
- **Combos:** admin `/admin/combos` (bundle subjects → one price/tier/duration); public `/combos` with Razorpay `ComboCheckout`; on verified payment grants a subscription per included subject (service role).
- **Payment-grant fix:** plan + combo subscription inserts now use the **service client** (students have no INSERT policy on `subscriptions`) — this fixes a latent bug in the Phase-5 plan flow.
- **Not built (strategic decision):** offline/download + "views/validity" delivery model.

---

## 22. Premium video — Bunny.net Stream (built, needs keys)
Decision: use **Bunny Stream** as-is (cheap; does transcode + adaptive HLS + CDN + MediaCage DRM). Hybrid/self-host plan in `docs/ENCRYPTED_VIDEO_PLAN.md` is parked.
- **Playback:** `lib/media.ts` `videoEmbedSrc` returns the Bunny embed `https://iframe.mediadelivery.net/embed/<lib>/<videoId>` when a section's `bunny_video_id` is set and `NEXT_PUBLIC_BUNNY_LIBRARY_ID` exists. Precedence: `embed_url` → Bunny → YouTube.
- **Watermark:** student email/phone overlaid on the player (`.vwm`, moves between corners every ~24s) — `SectionBody` gets a `watermark` prop on the topic page.
- **Admin upload (built):** video sections show **"⬆️ Upload video to Bunny"** (`BunnyUploader` + `bunnyActions.createBunnyUpload`). Uses Bunny's **TUS resumable** upload directly from the browser; the server only mints a short-lived signature (API key never hits the browser). On success the field is filled with the video GUID. **Needs `BUNNY_STREAM_API_KEY` in Vercel** (server-only); without it the button explains to paste a GUID instead. Dep added: `tus-js-client`.
- **Env to activate:** `NEXT_PUBLIC_BUNNY_LIBRARY_ID` (+ `BUNNY_STREAM_API_KEY`, `BUNNY_CDN_HOSTNAME` for later). Until set, Bunny sections show "Video coming soon"; YouTube/embed sections work regardless.

---

## 11. Working conventions
- Develop on branch `claude/landing-page-text-fix-C0lDT`, then fast-forward merge to `main`.
- Vercel auto-deploys on push to `main`.
- Always run `npm run build` before pushing (catches lint/type errors; JSX text must escape `'` `"` as entities).
- Secrets only in Vercel env / Supabase — never committed.
