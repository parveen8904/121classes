# 121 Coaching — Learning Portal Specification

**Status:** Draft for review
**Date:** 2026-06-08
**Owner:** Parveen Sharma
**Decisions locked so far:** Build a full portal (spec-first); payments via **Razorpay**; host on **our own new AWS account** (Mumbai / `ap-south-1`), discontinuing the old AWS; videos on **YouTube (unlisted)** for zero playback cost; ship **native iOS + Android apps** (React Native / Expo) alongside the web app.

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

**Decision:** the portal runs entirely on **our own AWS account** (Mumbai /
`ap-south-1`), replacing the old AWS and avoiding a separate hosting vendor.
See `docs/AWS_COST_AND_SETUP.md` for sizing, monthly cost, and setup steps.

| Layer | Choice (AWS) | Why |
|---|---|---|
| App framework | **Next.js (App Router)** | Pages + API routes in one codebase. |
| Hosting | **AWS Lightsail** (2 GB instance) — or EC2/Amplify later | Fixed, predictable price; runs the Next.js server + API. |
| Database | **Amazon RDS for PostgreSQL** (db.t4g.micro) — or Lightsail managed DB | Relational data fits the Course→Subject→Topic→Section model. |
| File storage | **Amazon S3** | Store PDFs (slides, question banks); private buckets + signed URLs for paid files. |
| CDN / delivery | **Amazon CloudFront** | Serves PDFs/static assets; first 1 TB/mo egress free. |
| Auth | **Amazon Cognito** | Student/admin login; first 10,000 monthly active users free. |
| Email | **Amazon SES** | OTP, receipts, notifications (~$0.10 / 1,000 emails). |
| DNS / domain | **Amazon Route 53** | Domain + DNS for the portal. |
| Access control | **App-layer authorization** (middleware/API guards) + DB constraints | Enforces free/paid + attempt filtering on every request (replaces Supabase RLS). |
| Payments | **Razorpay** | UPI/cards/netbanking; built for India. |
| AI | Claude API via **server-side route** | Ask Doubts + subjective grading; keys in env vars only (option: Amazon Bedrock). |
| Video | **YouTube (unlisted)** embeds; HeyGen for creation | Zero playback cost — see §12. Do **not** self-host video on S3/CloudFront. |
| Mobile apps | **React Native (Expo)** for iOS + Android | Native App Store / Play Store apps on the same backend — see §6A. |

> Notes:
> - **Auth/access control change:** without Supabase's built-in row-level
>   security, free/paid gating and exam-attempt filtering are enforced in the
>   **application layer** (Next.js middleware + API route guards) against the
>   RDS database. Every protected request checks the logged-in student's
>   `target_attempt` and `entitlements` before serving content.
> - The existing static `index.html` / `courses.html` can remain as the
>   **public marketing site** (served via S3 + CloudFront or by the Next.js
>   app), while the portal lives under an app route (e.g. `/app` or
>   `app.121coaching...`).
> - **Simplest start:** Lightsail instance + Lightsail managed Postgres is the
>   most cost-predictable launch setup; graduate to EC2 + RDS when needed.

---

## 6A. Mobile Apps (iOS & Android)

The portal ships as **native iOS and Android apps** in addition to the web app.
All three (web + iOS + Android) talk to the **same AWS backend** (Next.js API +
RDS + Cognito + S3/CloudFront), so there is one source of truth and no duplicate
business logic.

### Approach
| Option | What it is | Verdict |
|---|---|---|
| **React Native (Expo)** ✅ | One codebase → real native iOS + Android apps, hitting the same API | **Recommended** — true App Store / Play Store presence, push notifications, smooth UX, shared logic |
| **PWA (installable web app)** | The responsive web app, installable from the browser | Cheapest/fastest, **no store fees** — but no real store listing, weaker push/offline. Good as a **day-1 stopgap**. |
| **Capacitor (web wrapper)** | Wrap the web app in a native shell | Middle ground; fine if we want minimal extra code |

**Plan:** make the web app **fully responsive from day one** (works in mobile
browsers immediately), then build the **Expo (React Native) apps** for the
App Store and Play Store as a dedicated phase.

### What the apps do
Same features as the web portal — Cognito login, attempt-filtered content,
revision videos (YouTube player), PDF viewing, MCQ & subjective tests, Ask-Doubt
(AI), performance summary, and upgrades — plus **push notifications** (new
revision videos, test results, exam reminders) via Expo Push / FCM + APNs.

### ⚠️ Critical: in-app payments rule
Apple and Google generally **require their own in-app purchase (IAP) systems for
digital goods sold inside the app**, taking **15–30% commission**, and
**disallow external payment links (Razorpay) for digital content in-app.** This
directly affects our paid upgrades. Three workable patterns:

1. **"Reader" model (recommended to start):** sell upgrades on the **web** via
   Razorpay; the apps only **unlock** content for logged-in students who already
   paid. Avoids store commission; users just can't purchase *inside* the app.
2. **Store IAP in-app:** use Apple/Google billing and absorb the cut (Apple/
   Google both offer **15%** under $1M/year; 30% above).
3. **Hybrid:** web for purchases, apps for consumption.

> India's rules here are in flux (CCI rulings, Google Play billing policy) —
> confirm the current position before finalizing the in-app purchase approach.

### Store accounts & costs (one-time / annual)
| Item | Cost |
|---|---|
| **Apple Developer Program** | **$99/year** (~₹8,300/yr) — required to publish on the App Store |
| **Google Play Developer** | **$25 one-time** (~₹2,100) |
| Build/release (Expo EAS) | Free tier to start; paid tiers optional |

These are **separate from AWS** and only the store fees + development effort —
the backend is unchanged.

---

## 7. Database Schema (first draft)

```sql
profiles        (id, cognito_sub ⇄ Cognito user, full_name,
                 role: 'student'|'admin', target_attempt, created_at)

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

**Authorization (app-layer, since we're on RDS not Supabase):** Next.js
middleware + API route guards enforce — students read only published content
valid for their `target_attempt`; paid sections require a matching active
entitlement; students see only their own attempts/submissions; admins manage
everything. Cognito issues the login token; the API verifies it and looks up the
matching `profiles` row on every request.

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

Everything runs in **your own AWS account** (set up fresh; close the old AWS
after migrating — see `docs/AWS_COST_AND_SETUP.md`). Plus Razorpay and the AI
provider.

| Service | Purpose | You provide / configure |
|---|---|---|
| **AWS account** (new) | Lightsail/EC2, RDS, S3, CloudFront, Cognito, SES, Route 53 | Root account + IAM admin user; region `ap-south-1` |
| **Amazon Cognito** | Auth | User pool ID, app client ID |
| **Amazon RDS** | Database | Endpoint, DB name, user/password (in Secrets Manager) |
| **Amazon S3 + CloudFront** | PDF storage + delivery | Bucket name, CloudFront distribution |
| **Razorpay** | Payments | Key ID, Key Secret, Webhook secret |
| **AI provider** (Claude API) | Doubts + grading | API key (later); or use Amazon Bedrock |

Secrets live in **AWS Secrets Manager** / environment variables on the server —
**never** in the repo or client code. I'll scaffold the code and tell you
exactly where each value goes; I cannot create the AWS account or these
credentials for you.

---

## 11. Phased Roadmap

| Phase | Deliverable |
|---|---|
| **0. This spec** | Approve scope & model (you are here). |
| **0b. AWS setup** | Create the new AWS account, provision Lightsail/RDS/S3/CloudFront/Cognito, migrate off old AWS. |
| **1. Foundation** | Next.js app on Lightsail/EC2, RDS connected, Cognito auth (student/admin), DB schema + app-layer authorization. |
| **2. Admin content** | Admin panel to create Course→Subject→Topic→Section, upload PDFs, add video embeds. |
| **3. Student portal** | Dashboard + topic rendering + **attempt filtering**; migrate AS 24 content off the hardcoded page into the DB. |
| **4. Tests** | MCQ engine (auto-grade) + subjective submission flow. |
| **5. Payments** | Razorpay orders, signature + webhook verification, entitlements, free/paid gating live. |
| **6. AI** | Connect Ask-Doubt and subjective grading to the LLM API. |
| **7. Polish** | Performance summary, invoices, emails, analytics. |
| **8. Mobile apps** | React Native (Expo) iOS + Android apps on the same backend; push notifications; App Store + Play Store release. |

---

## 12. Indicative Costs (early stage)

Full breakdown in **`docs/AWS_COST_AND_SETUP.md`**. Summary:

- **AWS fixed cost** ≈ **₹2,500–3,400/month** at small scale (Lightsail app +
  RDS Postgres + S3 + CloudFront + Cognito/SES/Route 53). **Year-1 free tier**
  can bring this near ₹0 while building/piloting.
- **AI (Claude)** — pay-per-use; ~₹4.5k–14k/month at ~10k actions, far less with
  prompt caching and using Haiku for simple doubts. ₹0 when idle.
- **Razorpay** — ~2% per **successful** transaction only; no monthly fee.
- **Video** — keep on **YouTube (unlisted)** for **₹0 playback cost**. Do **not**
  self-host video on S3/CloudFront — egress (~₹9–14/GB) is the one real per-view
  cost. Create on HeyGen → download → upload to YouTube → embed.
- **Mobile apps** — store fees only: **Apple $99/year**, **Google $25 one-time**;
  plus dev effort. If selling upgrades **inside** the apps, Apple/Google take
  **15–30%** — see §6A for the "sell on web, unlock in app" workaround.

---

## 13. Migration from the Current Site

- Keep `index.html` as the public marketing page (rebrand links to the portal).
- The hand-built **AS 24 page becomes the first DB-driven topic** — its sections
  (Ask Doubt, videos, slides PDF, question bank, past papers, MCQ, subjective,
  performance) map 1:1 onto the new section model, validating the design.

---

## 14. Open Questions for You

1. **Auth method (via Cognito):** email + password, email OTP, Google sign-in, or phone OTP?
2. **Pricing unit:** sell **per-topic**, **per-subject**, or a **full-attempt pass** (or a mix)? Rough price points?
3. **Free trial / previews:** should locked sections show a short free preview?
4. **Single app vs split:** keep the marketing site separate and put the portal at `app.`, or move everything into the Next.js app?
5. **Domain:** what domain will this run on (for Route 53 + Razorpay setup)?
6. **AI provider:** Claude API directly, or via Amazon Bedrock (keeps it inside AWS billing)?
7. **Mobile timing:** build the iOS/Android apps in v1 alongside web, or ship responsive web first and add the apps in a later phase?
8. **In-app purchases:** for the apps, use the **"sell on web, unlock in app"** model (avoids Apple/Google's 15–30% cut) or use store in-app purchases?

*(Resolved: hosting = own AWS account; payments = Razorpay; video = YouTube unlisted; native iOS + Android apps in scope.)*

Once you confirm these, Phase 1 (foundation) can begin.
