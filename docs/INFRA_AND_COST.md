# 121 Coaching — Infrastructure & Cost Guide

**Status:** Draft for review
**Date:** 2026-06-09
**Owner:** Parveen Sharma
**Stack:** **Supabase + Vercel + Bunny.net + Zoom** (no AWS) — see
`docs/PORTAL_SPEC.md`.

> All prices are **indicative** — confirm current rates on each vendor's pricing
> page before committing. Conversion used: **₹84 ≈ $1**.

---

## 1. Services & what they cost

| Service | Role | Cost |
|---|---|---|
| **Supabase** | Auth (email+phone) + Postgres + Storage + RLS | Free tier to start → **$25/mo (~₹2,100)** Pro (8 GB DB, 100 GB storage, 250 GB bandwidth, 100k MAU) |
| **Vercel** | Next.js hosting (web + API) | Free (Hobby) → **$20/mo (~₹1,680)** Pro when needed |
| **Bunny.net** | Video streaming + storage (ad-free, secure) | Pay-as-you-go: **storage ~$0.01/GB/mo** + **delivery ~$0.01–0.03/GB** (India ≈ $0.03). Free encoding. ~$1 minimum. |
| **Zoom Webinar** | Live classes (1 license) | **~$90–100/mo (~₹7,500–8,400)** — Pro + Webinar-500 add-on (annual billing) |
| **Razorpay** | Payments (plans + books) | **~2% per successful transaction**; no monthly fee |
| **WhatsApp Business API** (BSP) | Enrolment messaging | BSP plan **~₹1,000–3,000/mo** + Meta per-message conversation charges (verify India rates) |
| **Email** (Resend / SendGrid) | Transactional + warehouse emails | Free tier → ~**$20/mo** at volume |
| **Claude API** | AI doubts + grading | Pay-per-use; cents per action, less with caching |
| **Apple / Google** (mobile) | App publishing | Apple **$99/yr**, Google **$25 one-time** |

---

## 2. Example monthly cost (small scale, a few hundred students)

| Item | ₹/mo |
|---|---|
| Supabase (Free → Pro) | ₹0 → ~₹2,100 |
| Vercel (Free → Pro) | ₹0 → ~₹1,680 |
| Bunny.net video (storage + delivery) | ~₹500–2,000 (scales with watch-time) |
| **Zoom Webinar** | ~₹7,500–8,400 |
| WhatsApp BSP (plan) | ~₹1,000–3,000 |
| Email | ₹0 → ~₹1,700 |
| **Fixed subtotal** | **~₹9,000–18,000** |

Plus **usage-based**: Razorpay ~2% of sales, WhatsApp per-message, Claude
per-action — all of which track revenue/engagement (₹0 when idle).

> **Biggest fixed cost is the Zoom Webinar license.** Everything else starts at or
> near **₹0** on free tiers and scales gradually. If you can defer live classes,
> the fixed base drops to roughly **₹2,000–6,000/mo**.

---

## 3. Video cost note (Bunny vs YouTube)

- **YouTube** = free playback but ads/limited access control.
- **Bunny.net** = a **small per-view cost** (delivery ~₹2.5/GB in India), in
  exchange for **no ads, token-secured playback, and full access control** — the
  right trade-off for **paid** course content.
- Rough example: a lecture averaging ~200 MB watched per view × 1,000 views ≈
  200 GB ≈ **~₹500/month** of delivery for that video. Adaptive streaming keeps it
  efficient.
- *(Optional)* keep a **public YouTube copy** for marketing/discovery; the
  in-platform copy stays on Bunny.

---

## 4. WhatsApp Business API note

- Requires a **BSP** (Business Solution Provider) — e.g. **Interakt, Gupshup,
  AiSensy, Wati**. They handle Meta onboarding, template approval, and the API.
- Costs = **BSP subscription** + **Meta per-conversation/message** charges
  (utility vs marketing categories differ; India pricing changed in 2024–25 —
  verify current rates with the chosen BSP).
- Messages must use **pre-approved templates** (e.g. an "enrolment confirmation"
  template).

---

## 5. What you need to create (I can't do these for you)

Supabase project, Vercel account (connect the GitHub repo), Bunny.net account
(Stream library + CDN zone), a **Zoom Webinar** license, a **Razorpay** account,
a **WhatsApp BSP** account (+ approved templates), and an **email** provider
(verified sending domain). I'll scaffold the code and tell you exactly where each
key goes.

---

## 6. Why this beats the earlier AWS plan for us

- **Less ops:** Supabase + Vercel are fully managed — no servers, patching, or DB
  administration.
- **Faster to build:** auth, DB, storage, and RLS come out of the box.
- **Pay-as-you-grow:** near-₹0 fixed base (excl. Zoom) until you have real usage.
- **Better video for paid content:** Bunny.net gives ad-free, access-controlled
  streaming that YouTube can't.
