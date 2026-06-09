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
- [ ] Connect **`121caclasses.com`** (primary) as the Vercel custom domain (+ DNS); add **`121coaching.ai`** as an alias to the same deployment; update Supabase Site URL/redirects.
- [ ] (Optional) Mailgun: verify `121caclasses.com` so email comes from `@121caclasses.com`.
- [ ] (Optional) Enable **single session per user** (Supabase → Authentication → Sessions; may need Pro).
- [ ] Replace placeholder copy (testimonials, stats, course/book details, announcement text, legal pages) with real content.

---

## 9. Phased roadmap (remaining)
1. ✅ **Phase 1 — Foundation** (auth, schema, dashboards) — DONE.
2. ✅ **Phase 2 — Admin content manager** — DONE. Full CRUD admin UI (see §11): Course→Subject→Topic→Section (type-aware section config incl. custom sections), faculty + subject assignment, announcements. RLS-driven (admin cookie passes `is_admin()`; no service-role key used).
3. **Phase 3 — Student portal:** render topics/sections + attempt filtering + plan gating; migrate the AS 24 sample into the DB.
4. **Phase 4 — Subscriptions & admin enrolment** (per-course, durations, bulk CSV grants).
5. **Phase 5 — Payments** (Razorpay for plans + books; book store + warehouse email).
6. **Phase 6 — Live + messaging** (Zoom; WhatsApp/Interakt + email).
7. **Phase 7 — Tests + AI** (MCQ auto-grade; subjective; Claude paper-checking + doubt-solving).
8. **Phase 8 — Reporting** (finance, student emails, warehouse).
9. **Phase 9 — Landing sections from DB** (amendments / what's new / resources editable).
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

## 11. Working conventions
- Develop on branch `claude/landing-page-text-fix-C0lDT`, then fast-forward merge to `main`.
- Vercel auto-deploys on push to `main`.
- Always run `npm run build` before pushing (catches lint/type errors; JSX text must escape `'` `"` as entities).
- Secrets only in Vercel env / Supabase — never committed.
