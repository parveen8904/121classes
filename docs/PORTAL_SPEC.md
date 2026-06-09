# 121 Coaching — Learning Portal Specification

**Status:** Draft for review
**Date:** 2026-06-09
**Owner:** Parveen Sharma

**Decisions locked so far:**
- Build a full **database-driven portal** + **native iOS + Android apps** (React Native / Expo) alongside the web.
- **No AWS.** Stack = **Supabase** (Postgres + Auth + Storage + RLS), **Vercel** (app hosting), **Bunny.net** (video streaming + storage), **Zoom Webinar** (live classes), **Razorpay** (payments), **WhatsApp Business API** (enrolment messaging), transactional **email**.
- **Auth:** email **and** phone-number (OTP) authentication.
- **Content model:** multiple **courses → subjects (one or more faculty each) → topics → sections**, including **admin-created custom sections**.
- **Access:** **per-course subscriptions** in **1 / 3 / 6 / 12-month** durations — the student **builds their own plan** (course × tier × duration); feature tiers **Bronze / Silver / Gold**; **auto-renew until cancelled**. **Admin can also manually enrol users (incl. bulk CSV) and grant any course/tier for any duration** (free).
- **Pricing:** **scales with duration** (longer = discounted), fully **admin-configurable**; web via **Razorpay** (recurring); **app prices ≈ 130–140% of web** via store billing, clearly disclosed.
- **Videos:** self-recorded by faculty (natural voice/accent), streamed **ad-free via Bunny.net** with English audio/dub track; optional public YouTube copy for marketing.
- **Commerce:** **sell physical books** (~10 titles, **free shipping**, **guest checkout**) on the landing page; warehouse gets an **end-of-day dispatch email**.
- **Reporting:** finance reports; automated **emails to students** and **emails to warehouse**.
- **Domain:** primary `121caclasses.com`; `121coaching.ai` is a live **alias** for the same site. **WhatsApp BSP:** **Interakt**.

---

## 1. Purpose & Vision

A **database-driven learning platform** (web + mobile apps) where:

- Students **sign up with email + phone**, get a **profile**, and set their
  **target exam attempt** (e.g., *May 2026*); content is **filtered** to what's
  valid for that attempt (amendments).
- An **admin panel** lets us create **courses → subjects → topics → sections**
  and upload videos/PDFs — **no code, no hardcoded pages** — including
  **custom-named sections**.
- Access is sold as **time-bound course subscriptions** in **Bronze/Silver/Gold**
  tiers; **admins can also hand-grant** access to any user for any duration.
- Students attend **live classes (Zoom webinars)**, watch **ad-free recorded
  videos (Bunny.net)**, download **PDFs**, take **MCQ & subjective tests**, use
  **AI Ask-a-Doubt**, and track **performance**.
- The site also **sells physical books**, runs **announcement/news sections**,
  and sends **WhatsApp + email** updates on enrolment.

---

## 2. Roles

| Role | Can do |
|---|---|
| **Visitor** | Browse the public landing page (amendments, what's new, student corner, industry/macro news, book store), buy books, sign up. |
| **Student** | Log in (email/phone), set attempt, view attempt-filtered content per their **active course subscriptions**, attend live classes, take tests, ask doubts, track performance, buy plans/books. |
| **Admin** (you / staff) | Everything content + commerce: courses/subjects/faculty/topics/sections, plans & pricing, **manual & bulk user enrolment with custom course+duration grants**, live-class scheduling, book/warehouse management, finance & email reporting. |
| **Faculty** | Headlines a subject (name/photo/bio shown); content can be attributed to them. |

---

## 3. Content Model (the core idea)

Everything is **data**, managed from the admin panel.

```
Course        e.g. "CA Intermediate"          ← multiple courses
 └ Subject    e.g. "Accounting"               ← multiple subjects per course
    │           (each subject headed by one or MORE faculty)
    └ Topic   e.g. "AS 24 – Discontinuing Operations"   ← "create a topic"
       └ Section (ordered list)                          ← "create sections"
            • built-in types (ask_doubt, revision_video, full_class_video, pdf, …)
            • OR a CUSTOM section you name yourself
```

- **Multiple courses**, each with **multiple subjects**; each **subject** headed
  by **one or more faculty** (many-to-many) with name, photo, bio.

### Section types (built-in)
| Type | Renders |
|---|---|
| `ask_doubt` | AI doubt-solving box |
| `revision_video` | Revision video — **First** or **Second** (flag on the section) |
| `full_class_video` | **Full coaching-class recording** |
| `live_class` | A scheduled/recorded **Zoom webinar** (join link + later recording) |
| `pdf` | View/**download** a PDF (slides, notes, question bank) |
| `mcq_test` | Auto-graded multiple-choice test |
| `subjective_test` | Written answers, AI-evaluated |
| `past_papers` | Past exam questions + marks/weightage |
| `rich_text` | Notes / formatted content |
| **`custom`** | **A section you create and name yourself** (your own label + any mix of video / pdf / text / link) |

### Custom sections (admin-created)
You can **create your own sections with any name** ("create section" → give it a
title like *"Author's Special Notes"* or *"Marathon Class"*, choose its contents,
set which **plan** unlocks it, order it). Pure admin action — no code change.

---

## 4. Exam-Attempt Filtering (amendments)

- **Student profile** stores `target_attempt` (e.g. `MAY_2026`, `NOV_2026`).
- Each **Topic** (optionally each Section/PDF/Video) carries a validity window
  (`valid_from_attempt` / `valid_to_attempt`) or `amendments_upto`.
- The portal shows a student **only** content valid for their attempt; admins can
  keep **multiple versions** of a topic for different attempts.

---

## 5. Subscriptions, Plans & Pricing

### Per-course subscriptions (student builds their own plan)
- A student **builds their own plan**: pick a **course**, a **tier**
  (Bronze/Silver/Gold), and a **duration** of **1 / 3 / 6 / 12 months**.
- Pricing **scales with duration** with a **discount for longer plans** (e.g. a
  per-month base price × months, less a longer-term discount). All numbers are
  **admin-configurable**, so you set/adjust them in the panel.
- Subscriptions **auto-renew** at period end **until the student cancels**
  (recurring via **Razorpay Subscriptions / UPI Autopay** on web; the store's
  auto-renewable subscriptions in-app). Cancelling stops future renewals; access
  runs to the end of the paid period.
- A student can hold multiple course subscriptions, each with its own dates.
- Within a course, the **tier** controls which features unlock:

| Plan | Unlocks |
|---|---|
| 🥉 **Bronze** | First + second revision videos, other videos, and **PDFs** (downloadable) |
| 🥈 **Silver** | Bronze **+ Ask Doubts (AI) + Subjective tests** |
| 🥇 **Gold** | **Everything**, incl. **full coaching-class videos** and **live classes** |

- Plans, what each unlocks, durations, and prices are **admin-configurable**.

### Admin-granted access (manual & bulk)
- Admins can **enrol users themselves** — single or **bulk upload (CSV)** — and
  **grant any course at any tier for any duration** at will, **without payment**
  (e.g., scholarship students, offline-paid students, institutional batches).
- Each grant creates a normal `subscription` row with admin-chosen `ends_at`.

### Web vs App pricing (clearly disclosed)
- **App Store / Play Store prices ≈ 130–140% of the web price** (covers
  Apple/Google commission). Apps show a **clear notice** at checkout:
  *"App Store pricing is higher than our website — the same plan is cheaper on
  121coaching.com."*
- Web → **Razorpay**; in-app → **Apple/Google billing** (see §6A).

### Razorpay flow (web)
Order created server-side → Razorpay Checkout (UPI/cards/netbanking) → **signature
verified server-side** → subscription granted/extended → **webhook** is the source
of truth. **Auto-renewing subscriptions use Razorpay Subscriptions (e-mandate /
UPI Autopay)**; the webhook handles renewals, failures, cancellations and refunds.
Same Razorpay account powers **book purchases** (§9).

> **Razorpay account note:** your existing Razorpay is registered to a *different*
> business/domain. For `121coaching.ai` you'll likely open a **separate Razorpay
> account** (or add this domain/entity under the existing one if it's the same
> legal entity). Decided at the payments phase — not a blocker for Phase 1.

### Downloads
- **PDFs/notes are downloadable** for entitled students.
- **Videos stream from Bunny.net** with **token-secured** playback (no public
  download); offline is not offered initially.

---

## 6. Tech Stack & Architecture

**No AWS.** The platform runs on managed services:

| Layer | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router)** | Web pages + API routes in one codebase. |
| App hosting | **Vercel** | First-class Next.js hosting; CDN + serverless API. |
| Auth | **Supabase Auth** | **Email + phone (OTP)** login; integrates with the DB. |
| Database | **Supabase Postgres** | Courses→Subjects→Topics→Sections, subscriptions, commerce. |
| File storage (PDFs) | **Supabase Storage** | Private buckets + signed URLs for paid PDFs. |
| Access control | **Supabase Row-Level Security (RLS)** | Enforces attempt-filtering + plan/subscription gating at the DB. |
| **Video streaming + storage** | **Bunny.net (Stream + CDN)** | Ad-free, token-authenticated, access-controlled video — full control vs YouTube. |
| **Live classes** | **Zoom Webinar** (1 license) | Host live sessions; auto-record into the topic. |
| Payments | **Razorpay** | Plans + book sales (UPI/cards/netbanking). |
| **Enrolment messaging** | **WhatsApp Business API** (via a BSP) | Send enrolment info/updates on WhatsApp. |
| Transactional email | **Resend / SendGrid** (or Supabase SMTP) | Student emails, **warehouse dispatch emails**, receipts. |
| AI | **Claude API** via server-side route | Ask Doubts + subjective grading; keys server-side only. |
| Mobile apps | **React Native (Expo)** | Native iOS + Android on the same Supabase backend (see §6A). |

> The existing static `index.html` / `courses.html` become the **public
> marketing site** (with the new sections in §10); the logged-in portal lives in
> the Next.js app (e.g. `app.121coaching...`).

---

## 6A. Mobile Apps (iOS & Android)

Native **iOS + Android** apps via **React Native (Expo)**, hitting the **same
Supabase backend + Next.js API** as the web — one source of truth.

- **Plan:** responsive web first (works in mobile browsers immediately), then the
  Expo apps as a dedicated phase.
- **Features:** Supabase login (email/phone), attempt-filtered content, Bunny.net
  video, PDFs, live classes, MCQ/subjective tests, Ask-Doubt, performance, plans,
  **push notifications** (Expo Push / FCM + APNs).
- **In-app payments — decision:** use **Apple/Google billing** with **app prices
  ≈ 130–140% of web**, plus a clear "cheaper on the website" notice. A student's
  subscription is honoured across web + both apps.
- **Store costs:** Apple Developer **$99/year**, Google Play **$25 one-time**;
  Expo EAS free tier to start.
- *India store-billing rules are in flux (CCI/Google Play) — confirm before
  store submission.*

---

## 6B. Video Strategy (Bunny.net)

Videos are **recorded by faculty themselves** — natural voice and accent, **no
AI/agent avatars**. They are **stored and streamed via Bunny.net Stream**.

- **Ad-free & access-controlled:** Bunny serves video over its CDN with **signed
  / token-authenticated URLs**, so only entitled students (right course + tier +
  attempt) can play — and there are **no ads**. This is cleaner for paid content
  than YouTube.
- **English dub / multi-audio:** the English version is provided as an
  **additional audio track / separate rendition** on Bunny (produced by you, since
  we're not using YouTube's auto-dub anymore). The player exposes the language
  switch. *(Producing the English dub is a content task; flag if you want help
  choosing a dubbing tool.)*
- **Optional YouTube marketing copy:** if you still want public discovery + ad
  revenue, upload a **public copy to YouTube** separately for marketing — the
  in-platform copy stays on Bunny, ad-free. (Optional, not required.)
- `sections.config` stores the Bunny `video_id` / library + the optional
  `youtube_public_id`.

---

## 6C. Live Classes (Zoom Webinar)

- One **Zoom Webinar license** hosts **live sessions** for students.
- A `live_class` section stores the **scheduled time + join link**; entitled
  students (per course/tier) see a **Join** button.
- After the session, the **recording** is attached to the same section (uploaded
  to Bunny.net) so it becomes an on-demand video.
- Zoom registration can be synced so only entitled students get the join link.

---

## 6D. Notifications — WhatsApp + Email

- **WhatsApp Business API** via **Interakt** (BSP): on **enrolment** (and key
  events — payment success, new live class, subscription expiry/renewal) the
  student receives a **WhatsApp message** with the relevant info. Uses **approved
  message templates** (Meta requirement).
- **Transactional email** for receipts, enrolment confirmations, **student
  notifications**, and **warehouse dispatch emails** for book orders (§9).

---

## 7. Database Schema (first draft)

```sql
profiles        (id ⇄ auth.users, full_name, email, phone,
                 role: 'student'|'admin'|'faculty', target_attempt, created_at)

courses         (id, title, slug, order_index, is_published)
subjects        (id, course_id→courses, title, slug, order_index)
faculties       (id, full_name, photo_url, bio)
subject_faculty (subject_id→subjects, faculty_id→faculties)        -- many-to-many

topics          (id, subject_id→subjects, title, slug, order_index,
                 valid_from_attempt, valid_to_attempt, amendments_upto, is_published)

sections        (id, topic_id→topics, type, title, order_index,
                 min_plan: null(free)|'bronze'|'silver'|'gold',
                 config jsonb, is_published)
                 -- revision_video: { revision:'first'|'second', bunny_video_id, youtube_public_id? }
                 -- full_class_video / live_class: { bunny_video_id, zoom_join_url?, starts_at? }
                 -- pdf: { storage_path, filename, downloadable:true }
                 -- custom: { blocks:[ {kind:'video'|'pdf'|'text'|'link', ...} ] }

mcq_questions / mcq_attempts / subjective_questions / subjective_submissions
                 -- (as before: tests + AI grading)

plans           (id, tier:'bronze'|'silver'|'gold', name, rank,
                 web_price_inr, app_price_inr, features jsonb, is_active)
subscriptions   (id, student_id→profiles, course_id→courses, plan_id→plans,
                 channel:'web'|'ios'|'android'|'admin_grant',
                 starts_at, ends_at, status:'active'|'expired'|'cancelled',
                 granted_by_admin_id?)                 -- per-course, time-bound
orders          (id, student_id, kind:'subscription'|'book', ref_id, channel,
                 razorpay_order_id|store_txn_id, amount_inr, status, created_at)

-- Commerce (books)
books           (id, title, author, description, cover_url, price_inr,
                 stock_qty, is_active)
book_orders     (id, student_id|guest_contact, items jsonb, amount_inr,
                 razorpay_order_id, ship_to jsonb, status:'paid'|'dispatched'|'delivered',
                 warehouse_notified_at, created_at)

-- Live + messaging + content
live_sessions   (id, section_id→sections, zoom_webinar_id, starts_at, join_url,
                 recording_bunny_id?)
notifications    (id, student_id, channel:'whatsapp'|'email', template, payload jsonb,
                 status, sent_at)
announcements   (id, kind:'amendment'|'whats_new'|'student_corner'|'industry'|'macro',
                 title, body, link_url, published_at, is_published)

doubts          (id, student_id, section_id, question, ai_answer, status, created_at)
```

**Authorization:** **Supabase RLS** enforces — students read only published
content valid for their `target_attempt`; a section is served only if `free` or
the student has an **active subscription to that course at/above `min_plan`**;
students see only their own attempts/submissions/orders; admins manage everything.

---

## 8. Landing Page (public site) — new sections

The marketing site (`index.html` and the portal's public pages) gets these
**content sections**, each admin-managed via `announcements`:

| Section | Purpose |
|---|---|
| **New Amendments** | Latest syllabus/law amendments students must know |
| **What's New** | Announcements / new releases (member updates) |
| **Student Corner** | Resources, tips, success stories for students |
| **What's Happening in Industry** | Industry news relevant to the course |
| **Macroeconomics / World** | Links & notes to follow global macro / economy |
| **Book Store** | Browse & **buy physical books** (see §9) |
| **Live Classes** | Upcoming Zoom webinars / promos |

All are editable from the admin panel (no code change to publish a new item).

---

## 9. Book Store & Warehouse Fulfilment

- **Sell physical books** on the landing page — **~10 titles** to start
  (`books` catalogue: cover, price, stock). **Free shipping** (no fee), pan-India.
- **Guest checkout allowed** — buyers can purchase **without an account** (we
  capture name, phone, email, shipping address).
- Checkout via **Razorpay**; on payment success a **`book_order`** is created.
- The warehouse gets an **end-of-day email** listing that day's paid orders
  (book + buyer + address) for **dispatch**; status moves `paid → dispatched →
  delivered`.
- The buyer gets a **WhatsApp + email** confirmation.

---

## 10. Reporting

| Report | Contents |
|---|---|
| **Finance** | Revenue by plan/course/book, Razorpay settlements, refunds, period summaries (for accounting) |
| **Student emails** | Automated/triggered emails to students (enrolment, expiry reminders, results) |
| **Warehouse emails** | Per book order — what to dispatch, to whom, address; daily dispatch list |
| **Enrolment / activity** | Active subscriptions, expiries due, admin-granted access, engagement |

---

## 11. AI Features (wired later)

- **Ask a Doubt:** question + topic context → server route → Claude → answer saved
  to `doubts`. Keys server-side only.
- **Subjective evaluation:** student answer + rubric → Claude → score + feedback
  saved to `subjective_submissions`.
- UI for both already exists as placeholders on the current AS 24 page.

---

## 12. Accounts & Secrets You'll Need

| Service | Purpose | You provide |
|---|---|---|
| **Supabase** | Auth (email+phone) + Postgres + Storage + RLS | Project URL, anon key, service-role key |
| **Vercel** | App hosting | Connect the GitHub repo |
| **Bunny.net** | Video streaming + storage | API key, Stream library + CDN zone |
| **Zoom** | Live webinars | 1 Webinar license; API/JWT or OAuth app creds |
| **Razorpay** | Payments (plans + books) | Key ID, Key Secret, Webhook secret |
| **Interakt** (WhatsApp BSP) | WhatsApp Business API | Interakt account + approved templates + API token |
| **Email** (Resend/SendGrid) | Transactional + warehouse emails | API key, verified domain |
| **AI** (Claude API) | Doubts + grading | API key (later) |

Secrets live in **Vercel env vars / Supabase** — never in the repo or client.
I'll scaffold the code and tell you exactly where each key goes; I can't create
these accounts for you.

---

## 13. Phased Roadmap

| Phase | Deliverable |
|---|---|
| **0. This spec** | Approve scope & model (you are here). |
| **1. Foundation** | Next.js on Vercel + Supabase; **email+phone auth**; DB schema + RLS. |
| **2. Admin content** | Course→Subject→Topic→Section, **faculty manager**, **custom sections**, Bunny video upload, downloadable PDFs. |
| **3. Student portal** | Dashboard + topic rendering + **attempt filtering** + per-course/tier gating; migrate AS 24 into the DB. |
| **4. Subscriptions & admin enrolment** | Per-course time-bound plans; **manual + bulk (CSV) enrolment** with custom duration. |
| **5. Payments** | Razorpay for plans **and books**; webhooks; book store + **warehouse email**. |
| **6. Live + messaging** | Zoom webinar integration; **WhatsApp Business** + email notifications on enrolment. |
| **7. Tests + AI** | MCQ auto-grade; subjective flow; connect Claude for doubts + grading. |
| **8. Reporting** | Finance, student-email, warehouse, enrolment reports. |
| **9. Landing sections** | Amendments / What's New / Student Corner / Industry / Macro / Book store. |
| **10. Mobile apps** | Expo iOS + Android; store billing (130–140%); push notifications. |

---

## 14. Indicative Costs (early stage)

Full breakdown in **`docs/INFRA_AND_COST.md`**. Summary (₹84 ≈ $1):

- **Supabase** — free tier → **$25/mo (~₹2,100)** Pro when needed.
- **Vercel** — free (Hobby) → **$20/mo (~₹1,680)** Pro when needed.
- **Bunny.net** — pay-as-you-go: storage ~$0.01/GB/mo + delivery ~$0.01–0.03/GB
  (India). Modest, scales with watch-time; **ad-free + secure**.
- **Zoom Webinar** — ~**$90–100/mo (~₹7,500–8,400)** for one Pro + Webinar-500
  license (annual billing).
- **WhatsApp Business API (Interakt)** — plan ~**₹1,000–3,000/mo** + per-message
  (Meta) conversation charges; verify current India rates.
- **Email** (Resend/SendGrid) — free tier → ~$20/mo at volume.
- **Razorpay** — ~2% per successful transaction (plans + books); no monthly fee.
- **AI (Claude)** — pay-per-use; far less with caching + Haiku for simple doubts.
- **Mobile** — Apple $99/yr, Google $25 one-time.

> Biggest fixed item is **Zoom Webinar**; everything else starts at/near free and
> scales with usage. Video now has a **small per-view Bunny cost** (vs YouTube's
> free playback) — the trade-off is **full control, no ads, and access security**.

---

## 15. Migration from the Current Site

- Keep `index.html` as the public marketing page; add the §8 sections.
- The hand-built **AS 24 page becomes the first DB-driven topic** — its sections
  map 1:1 onto the new model, validating the design.

---

## 16. Decisions — Locked & Remaining

**Locked:**
- Stack = **Supabase + Vercel + Bunny.net + Zoom** (no AWS).
- Auth = **email + phone (OTP)**.
- Subscriptions = **per-course**, durations **1 / 3 / 6 / 12 months**, **student
  builds own plan**, pricing **scales with duration (longer = discount)**,
  **auto-renew until cancelled**; **admin manual + bulk grants**.
- Tiers = **Bronze / Silver / Gold** (admin-configurable).
- Payments = **Razorpay** (recurring); **app prices ≈ 130–140% of web**.
- Video = **Bunny.net** (ad-free, secure); English audio track; optional public
  YouTube marketing copy.
- Live classes = **Zoom Webinar**.
- Notifications = **Interakt (WhatsApp)** + email.
- Books = **~10 titles, free shipping, guest checkout**; **warehouse end-of-day
  dispatch email**.
- Mobile = **responsive web first, native apps later**.
- Domain = **`121coaching.ai`**.

**Remaining (not blocking Phase 1 — resolve at the noted phase):**
1. **Actual plan price numbers** — set in the admin panel; start with placeholders.
   *(Phase 5)*
2. **Razorpay account** — reuse existing (same legal entity) or open a new one for
   `121coaching.ai`. *(Phase 5)*
3. **Domain spelling** — confirm exact registered domain (`121coaching.ai`).
4. **Account creation** — Supabase + Vercel (Phase 1); Bunny/Zoom/Interakt/Razorpay
   at their phases. I'll guide you; I can scaffold with placeholders meanwhile.

**Phase 1 (Foundation) is unblocked and ready to start.**
