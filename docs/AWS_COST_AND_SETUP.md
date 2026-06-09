# 121 Coaching — AWS Cost & Setup Guide

> ⚠️ **SUPERSEDED (2026-06-09).** We are **not using AWS**. The stack is now
> **Supabase + Vercel + Bunny.net + Zoom** — see **`docs/INFRA_AND_COST.md`** and
> **`docs/PORTAL_SPEC.md`**. This file is kept for historical reference only.

**Status:** Superseded — historical reference
**Date:** 2026-06-08
**Owner:** Parveen Sharma
**Decision:** ~~Host the portal on our own new AWS account, region Mumbai
(`ap-south-1`), and discontinue the old AWS after migrating.~~ **Reversed — no AWS.**

> All prices are **indicative** — confirm live rates in the AWS Pricing
> Calculator for `ap-south-1` before committing. Conversion used: **₹84 ≈ $1**.

---

## 1. What the portal needs on AWS

| Need | AWS service | Notes |
|---|---|---|
| App hosting (Next.js) | **Lightsail** (or EC2/Amplify later) | Runs the Next.js server + API routes |
| Database | **RDS for PostgreSQL** (or Lightsail managed DB) | Course→Subject→Topic→Section data |
| File storage (PDFs) | **S3** | Slides, question banks; private buckets |
| PDF/asset delivery | **CloudFront** (CDN) | First **1 TB/month egress free** |
| Login / auth | **Cognito** | First **10,000 monthly active users free** |
| Email (OTP, receipts) | **SES** | ~$0.10 per 1,000 emails |
| Domain + DNS | **Route 53** | ~$0.50/mo per zone + domain ~$12–15/yr |
| Secrets | **Secrets Manager** | DB password, Razorpay & AI keys (~$0.40/secret/mo) |

> **Videos stay on YouTube (unlisted) — ₹0 playback cost.** Do **not** put
> videos on S3/CloudFront; egress (~₹9–14/GB) is the one real per-view cost.

---

## 2. Steady-state monthly cost (small scale: a few hundred students)

| Item | Spec | USD/mo | ₹/mo |
|---|---|---|---|
| App server | Lightsail 2 GB (or EC2 t4g.small) | ~$12 | ~₹1,000 |
| Database | RDS db.t4g.micro Postgres + 20 GB | ~$15 | ~₹1,260 |
| S3 (PDFs) | a few GB | ~$0.50 | ~₹40 |
| CloudFront | PDFs (within 1 TB free) | ~$0–2 | ~₹0–170 |
| Cognito | < 10k MAU | $0 | ₹0 |
| SES + Route 53 + Secrets | low volume | ~$2 | ~₹170 |
| **AWS subtotal** | | **~$30–40** | **~₹2,500–3,400** |

**On top of AWS (usage-based, not AWS):**
- **Claude AI** — pay-per-use; ~₹4.5k–14k/mo at ~10k actions, much less with
  prompt caching + Haiku for simple doubts. ₹0 when idle.
- **Razorpay** — ~2% per **successful** transaction only; no monthly fee.

---

## 3. Year-1 Free Tier

A **new AWS account** gets a free tier — but **AWS changed this in mid-2025**:
newer accounts get a **credit-based plan (~$100–200 in credits, ~6 months)**
instead of the old 12-month always-free model. Which you get depends on your
signup date — **verify in the console when you create the account.** Either way,
EC2/RDS micro instances, S3, CloudFront (1 TB), Cognito (10k MAU) and SES have
meaningful free allowances, so **months 1–6 can run near ₹0** of fixed cost
while building and piloting.

---

## 4. Simplest, most predictable launch setup

Use **AWS Lightsail** (fixed-price VPS + managed DB — no metered-bill creep):

| Component | Plan | Cost |
|---|---|---|
| Lightsail instance | 2 GB RAM | $12/mo |
| Lightsail managed Postgres | micro | $15/mo |
| **Total** | | **~$27/mo (~₹2,270) flat** |

Plus S3/CloudFront in pennies. Graduate to **EC2 + RDS** when you outgrow it.

---

## 5. Setting up the new AWS account

1. **Create the account** at aws.amazon.com (root email + payment method).
2. **Secure the root user:** enable MFA; then create an **IAM admin user** and
   use that day-to-day (don't use root for normal work).
3. **Set region** to **`ap-south-1` (Mumbai)**.
4. **Set a billing alarm / Budget** (e.g. alert at ₹3,000 and ₹6,000) so there
   are no surprises.
5. **Provision services** (Lightsail instance + DB, S3 bucket, CloudFront,
   Cognito user pool, SES identity, Route 53 zone). Store all secrets in
   **Secrets Manager**.

---

## 6. Migrating off the OLD AWS — do this in order

1. **Export everything first** — database dump, all S3 files, configs — into the
   new account.
2. **Repoint domain/DNS** (Route 53) to the new account; verify the site works
   end-to-end.
3. **Check for commitments** on the old account — **Reserved Instances**,
   **Savings Plans**, or **annual support plans** bill regardless of usage;
   cancel or let them lapse.
4. **Then close the old account** (Billing → Account settings). Closure stops all
   charges; AWS keeps it recoverable for 90 days.

> ⚠️ **Do not close the old account until the new one is live and data is
> verified** — closure is disruptive to anything still pointing at it.

---

## 7. AWS vs managed (Supabase/Vercel) — the trade-off

| | Own AWS (chosen) | Supabase + Vercel |
|---|---|---|
| Ownership | Full — one bill, your infra | Split across vendors |
| Cost at launch | Near ₹0 (free tier) → ~₹2.5–3.4k/mo | Free tier → ~₹3.8k/mo |
| Setup & maintenance | **More** (you run the pieces) | **Less** (managed for you) |
| Best when | You want control + already know AWS | You want fastest time-to-launch |

**Decision:** own AWS, for ownership and to consolidate onto one account you
control (replacing the old AWS).

---

## 8. Open question

- **AI provider:** call the **Claude API directly**, or via **Amazon Bedrock**
  (keeps AI usage inside your AWS bill and IAM)? Either works; Bedrock
  centralizes billing, the direct API is simplest to wire.
