# 121 Coaching — Learning Portal Specification

**Status:** Draft for review
**Date:** 2026-06-08
**Owner:** Parveen Sharma
**Decisions locked so far:** Build a full portal (spec-first); payments via **Razorpay**.

---

## 1. Purpose & Vision

Move from the current **hardcoded static site** (one HTML file per topic) to a
**database-driven learning portal (LMS)** where:

- Students **log in** and have their own **profile**.
- Each student sets their **target exam attempt** (e.g., *May 2026*), and the
  portal **filters content** so they only see material valid for that attempt
  (e.g., amendments applicable up to May 2026).
- An **admin panel** lets us **create topics and sections and upload videos &
  PDFs** without writing or deploying code. No more hardcoded pages.
- Each section can be **free (non-chargeable)** or a **paid upgrade**; students
  pay via Razorpay to unlock locked sections.
- AI powers **Ask a Doubt** and **subjective answer evaluation** (keys stored
  server-side, wired in later).

---

## 2. Roles

| Role | Can do |
|---|---|
| **Visitor** | Browse public landing page, see free previews, sign up. |
| **Student** | Log in, set/change target attempt, view filtered content, take MCQ & subjective tests, ask doubts, buy upgrades, see performance summary. |
| **Admin** (you / faculty) | Create courses, subjects, topics, sections; upload videos & PDFs; set free/paid flags; tag content by exam attempt; author MCQ & subjective questions; view student activity. |

---

## 3. Content Model (the core idea)

Everything becomes **data**, managed from the admin panel — not hardcoded files.

```
Course        e.g. "CA Intermediate"
 └ Subject    e.g. "Accounting"
    └ Topic   e.g. "AS 24 – Discontinuing Operations"   ← "create a topic"
       └ Section (ordered list)                          ← "create sections"
            • type: ask_doubt   | free
            • type: video       | free or paid
            • type: pdf         | free or paid
            • type: mcq_test     | free
            • type: subjective  | paid
            • type: past_papers | free
```

### Section types (initial set)
| Type | What it renders | Default |
|---|---|---|
| `ask_doubt` | AI doubt-solving box | Free |
| `video` | Embedded video (HeyGen / uploaded) | Configurable |
| `pdf` | View/download a PDF (slides, question bank) | Configurable |
| `mcq_test` | Auto-graded multiple-choice test | Free |
| `subjective_test` | Written answers, AI-evaluated | Paid (typical) |
| `past_papers` | Past exam questions + marks/weightage | Free |
| `rich_text` | Notes / formatted content | Free |

Adding a new section type later is a code change; creating sections **of an
existing type** is a pure admin action.

---

## 4. Exam-Attempt Filtering (amendments)

The key personalization rule you described.

- **Student profile** stores `target_attempt` (e.g., `MAY_2026`, `NOV_2026`).
- Each **Topic** (and optionally each **Section/PDF/Video**) carries:
  - `valid_from_attempt` and `valid_to_attempt`, **or**
  - `amendments_applicable_upto` (a date / attempt label).
- The portal shows a student **only** content whose validity window covers their
  `target_attempt`. Example: a *May 2026* student sees the version of AS 24 with
  amendments covered till May 2026; a *Nov 2026* student sees the Nov 2026 version.
- Admin can maintain **multiple versions** of the same topic for different attempts.

---

## 5. Free vs Paid (Entitlements) + Razorpay

### Model
- Each section has `access: 'free' | 'paid'`.
- Paid access is granted by **products/plans** the admin defines, e.g.:
  - *Topic upgrade* (unlock all paid sections in one topic), or
  - *Subject pass* (unlock everything in a subject), or
  - *Full attempt pass*.
- A student's unlocked content is tracked in an **`entitlements`** table.

### Razorpay payment flow
1. Student clicks **Upgrade** on a locked section.
2. Backend creates a **Razorpay Order** (amount, currency INR, receipt) and
   returns the `order_id`.
3. Frontend opens **Razorpay Checkout** (UPI / cards / netbanking).
4. On success, Razorpay returns `payment_id` + `signature`.
5. Backend **verifies the signature** (HMAC with key secret) — never trust the
   client — and on success **creates an entitlement** for that student.
6. A **Razorpay webhook** is also handled server-side as the source of truth for
   payment status (handles edge cases / refunds).

### Access check (every protected request)
`is_free(section)` **OR** student has an active `entitlement` covering it → serve;
otherwise show the upgrade prompt.

---

## 6. Tech Stack & Architecture

| Layer | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router)** | Pages + API routes in one codebase; great DX; deploys to Vercel. |
| Hosting | **Vercel** | First-class Next.js hosting; GitHub Pages cannot run a backend. |
| Auth | **Supabase Auth** | Email/password + OTP/social; integrates with the DB. |
| Database | **Supabase Postgres** | Relational data fits the Course→Subject→Topic→Section model. |
| File storage | **Supabase Storage** | Store/serve PDFs and any uploaded videos; signed URLs for paid files. |
| Access control | **Postgres Row-Level Security (RLS)** | Enforces free/paid + attempt filtering at the database, not just UI. |
| Payments | **Razorpay** | UPI/cards/netbanking; built for India. |
| AI | Provider API via **server-side route** | Ask Doubts + subjective grading; keys in env vars only. |
| Video | HeyGen embeds now; uploaded video via Storage later | Reuse existing HeyGen embeds. |

> Note: the existing static `index.html` / `courses.html` can remain as the
> **public marketing site**, while the portal lives under an app route (e.g.
> `/app` or `app.121coaching...`). Or the whole thing moves into Next.js.

---

## 7. Database Schema (first draft)

```sql
profiles        (id ⇄ auth.users, full_name, role: 'student'|'admin',
                 target_attempt, created_at)

courses         (id, title, slug, order_index, is_published)
subjects        (id, course_id→courses, title, slug, order_index)
topics          (id, subject_id→subjects, title, slug, order_index,
                 valid_from_attempt, valid_to_attempt,
                 amendments_upto, is_published)

sections        (id, topic_id→topics, type, title, order_index,
                 access: 'free'|'paid', config jsonb, is_published)
                 -- config holds type-specific data:
                 -- video: { provider, embed_url }
                 -- pdf:   { storage_path, filename }
                 -- past_papers: { rows:[...], weightage, chance }

mcq_questions   (id, section_id→sections, question, options jsonb,
                 correct_index, order_index)
mcq_attempts    (id, student_id→profiles, section_id, score, total,
                 answers jsonb, created_at)

subjective_questions (id, section_id→sections, prompt, max_marks)
subjective_submissions (id, student_id, question_id, answer_text,
                 ai_score, ai_feedback, status, created_at)

products        (id, name, scope: 'topic'|'subject'|'attempt',
                 scope_ref_id, price_inr, is_active)
orders          (id, student_id, product_id, razorpay_order_id,
                 amount_inr, status, created_at)
entitlements    (id, student_id, scope, scope_ref_id, granted_via_order,
                 active, created_at)

doubts          (id, student_id, section_id, question, ai_answer,
                 status, created_at)
```

RLS policies enforce: students read only published content valid for their
attempt; paid sections require a matching active entitlement; students see only
their own attempts/submissions; admins manage everything.

---

## 8. Key Screens

### Student portal
- **Sign up / Log in** (set target attempt on first login)
- **Dashboard** — courses/subjects relevant to their attempt
- **Topic page** — renders its sections in order (Ask Doubt, videos, PDFs,
  tests, past papers); locked sections show an **Upgrade** button
- **MCQ test** — take, auto-score, review
- **Subjective test** — submit, see AI feedback (when wired)
- **Performance summary** — scores & feedback across the topic/subject
- **Account / Billing** — attempt, purchases, invoices

### Admin panel
- **Content manager** — create/reorder Course → Subject → Topic → Section
- **Section editor** — pick type, set free/paid, upload PDF / paste video embed,
  author MCQ & subjective questions
- **Attempt tagging** — set validity window / amendments-upto per topic
- **Products & pricing** — define topic/subject/attempt passes (INR)
- **Students** — view profiles, attempts, activity, entitlements

---

## 9. AI Features (wired later)

- **Ask a Doubt:** student question + topic context → server route → LLM → answer
  stored in `doubts`. Keys in env vars (server-side only).
- **Subjective evaluation:** student answer + model rubric → LLM → `ai_score` +
  `ai_feedback` saved to `subjective_submissions`.
- The UI for both already exists (as placeholders) on the current page and will
  be carried into the portal.

---

## 10. Hosting, Accounts & Secrets You'll Need

All have free tiers to start:

| Service | Purpose | You provide |
|---|---|---|
| **Supabase** | Auth + DB + Storage | Project URL, anon key, service-role key |
| **Vercel** | App hosting | Connect the GitHub repo |
| **Razorpay** | Payments | Key ID, Key Secret, Webhook secret |
| **AI provider** | Doubts + grading | API key (later) |

Secrets live in environment variables (Vercel project settings) — **never** in
the repo or client code. I'll scaffold the code and tell you exactly where each
key goes; I cannot create these accounts for you.

---

## 11. Phased Roadmap

| Phase | Deliverable |
|---|---|
| **0. This spec** | Approve scope & model (you are here). |
| **1. Foundation** | Next.js app on Vercel, Supabase connected, auth (student/admin), DB schema + RLS. |
| **2. Admin content** | Admin panel to create Course→Subject→Topic→Section, upload PDFs, add video embeds. |
| **3. Student portal** | Dashboard + topic rendering + **attempt filtering**; migrate AS 24 content off the hardcoded page into the DB. |
| **4. Tests** | MCQ engine (auto-grade) + subjective submission flow. |
| **5. Payments** | Razorpay orders, signature + webhook verification, entitlements, free/paid gating live. |
| **6. AI** | Connect Ask-Doubt and subjective grading to the LLM API. |
| **7. Polish** | Performance summary, invoices, emails, analytics. |

---

## 12. Indicative Costs (early stage)

- Supabase, Vercel, Razorpay all have **free/low tiers** suitable for launch.
- Real costs scale with usage: storage/bandwidth for videos & PDFs, AI API usage
  (per doubt / per evaluation), and Razorpay's per-transaction fee on paid sales.
- Hosting uploaded **video** is the most bandwidth-heavy item — keeping videos on
  HeyGen/YouTube/Vimeo embeds (vs self-hosting) keeps costs low early on.

---

## 13. Migration from the Current Site

- Keep `index.html` as the public marketing page (rebrand links to the portal).
- The hand-built **AS 24 page becomes the first DB-driven topic** — its sections
  (Ask Doubt, videos, slides PDF, question bank, past papers, MCQ, subjective,
  performance) map 1:1 onto the new section model, validating the design.

---

## 14. Open Questions for You

1. **Auth method:** email + password, email OTP, Google sign-in, or phone OTP?
2. **Pricing unit:** sell **per-topic**, **per-subject**, or a **full-attempt pass** (or a mix)? Rough price points?
3. **Free trial / previews:** should locked sections show a short free preview?
4. **Video hosting:** keep using HeyGen/embeds, or do you want to upload video files into the portal?
5. **Single app vs split:** keep the marketing site separate and put the portal at `app.` , or move everything into the Next.js app?
6. **Domain:** what domain will this run on (for Vercel + Razorpay setup)?
7. **AI provider:** any preference for the doubt-solving / grading model?

Once you confirm these, Phase 1 (foundation) can begin.
