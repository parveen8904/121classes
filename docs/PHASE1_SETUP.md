# Phase 1 — Foundation Setup

This is the scaffolded **Next.js + Supabase** foundation: email/phone login, the
database schema, and student/admin dashboard shells. Follow these steps to run it
live. (Until then the code is complete but needs keys + `npm install`.)

## What's in the repo now
```
app/                 Next.js App Router
  page.tsx           Public home → links to /login
  login/             Email magic-link + phone OTP login
  auth/callback/     Email link → session exchange
  dashboard/         Student dashboard (auth-guarded)
  admin/             Admin panel shell (admin-role-guarded)
lib/supabase/        Browser + server Supabase clients
middleware.ts        Session refresh + route protection
supabase/migrations/ 0001_init.sql  (full schema + RLS + seed plans)
index.html, courses.html   Existing marketing pages (unchanged)
```

## 1. Install dependencies
```bash
npm install
```

## 2. Create a Supabase project
1. Sign up at **https://supabase.com** → **New project** (region: closest to India, e.g. Mumbai/Singapore).
2. **Project Settings → API** — copy the **Project URL**, the **anon public** key, and the **service_role** key.

## 3. Add environment variables
Copy `.env.example` to `.env.local` and fill in:
```bash
cp .env.example .env.local
```
```
NEXT_PUBLIC_SUPABASE_URL=...        # Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # anon public key
SUPABASE_SERVICE_ROLE_KEY=...       # service_role key (server only)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 4. Create the database schema
In Supabase → **SQL Editor** → paste the contents of
`supabase/migrations/0001_init.sql` → **Run**. This creates all tables, RLS
policies, the new-user trigger, and three starter plans (Bronze/Silver/Gold —
prices are placeholders you can edit later).

## 5. Configure auth providers
- **Email:** on by default (magic link). In **Authentication → URL Configuration**,
  add `http://localhost:3000/auth/callback` (and later your production URL) to the
  redirect allow-list.
- **Phone (SMS OTP):** **Authentication → Providers → Phone** → enable, and connect
  an SMS provider (e.g. **Twilio / MSG91**). Phone login won't send codes until
  this is configured.

## 6. Run it
```bash
npm run dev
```
Open **http://localhost:3000** → **Log in** → sign in with email (magic link) or
phone (OTP). A `profiles` row is created automatically.

## 7. Make yourself an admin
After your first login, in Supabase → **Table editor → profiles**, set your row's
`role` to `admin`. Reload `/admin` — you'll see the admin panel.

## Deploying (later)
Connect this repo to **Vercel**, add the same env vars in the Vercel project
settings, and point `121coaching.ai` at it. (Vercel auto-builds Next.js.)

## What's next
- **Phase 2:** Admin content manager (courses → subjects → topics → sections),
  faculty, custom sections, Bunny.net video upload, PDF upload.
- **Phase 3:** Student topic rendering + attempt filtering + plan gating.
- Then tests, subscriptions/payments, live classes, WhatsApp/email, books, reporting.
