import { supporterReadiness } from "../lib/supporterReady";

// A VENDOR MAY LOOK, FILL IN AND LEARN. THEY MAY NOT TAKE MONEY.
//
// The rule this guards is not "hide the page". It is "no order until the
// paperwork is done" — and those are different things. A vendor who has just
// been given an account should be able to walk the whole form, see what a
// student pays and what they pay, and understand what they are joining. The
// only door that is shut is payment.
//
// Both the page and the server ask this one function, so what the screen says
// and what the server does cannot disagree. That drift is exactly what this
// file exists to prevent.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

const complete = {
  full_name: "Ascent Academy", business_name: "Ascent Academy",
  email: "books@ascent.in", phone: "9810000000",
  address_line1: "12 Nehru Place", city: "Delhi", state: "Delhi", pincode: "110019",
  supporter_site: "https://ascent.in", supporter_site_ok_at: "2026-08-01T00:00:00Z",
  supporter_terms_at: "2026-08-01T00:00:00Z",
};

check(supporterReadiness(complete).ready, "a complete, verified, unblocked vendor may sell");

// ── Each requirement, one at a time ───────────────────────────────────────
const musts: [string, Record<string, unknown>][] = [
  ["no phone", { phone: "" }],
  ["no state on the billing address", { state: "" }],
  ["no PIN code", { pincode: "" }],
  ["no website declared", { supporter_site: "" }],
  ["website declared but never verified", { supporter_site_ok_at: null }],
  ["terms not accepted", { supporter_terms_at: null }],
];
for (const [what, patch] of musts) {
  const r = supporterReadiness({ ...complete, ...patch } as never);
  check(!r.ready, `${what} → cannot place an order`);
  if (!r.ready) {
    check(!r.blocked, `${what} is incomplete, NOT "on hold" — the two must not be confused`);
    check(r.missing.length > 0 && r.missing.every((m) => m.what && m.why && m.href),
      `${what} → every item says what, why, and where to do it`);
  }
}

// A declared-but-unverified site must not be reported as "no website" — the
// vendor has done that step and would go round in circles looking for it.
const unver = supporterReadiness({ ...complete, supporter_site_ok_at: null } as never);
check(!unver.ready && unver.missing.some((m) => /proof/i.test(m.what)),
  "an unverified site asks for PROOF, not for the site again");

// ── On hold outranks everything ───────────────────────────────────────────
const held = supporterReadiness({ ...complete, supporter_blocked_at: "2026-08-05T00:00:00Z", supporter_block_reason: "Sold at 20% off." } as never);
check(!held.ready, "an account on hold cannot order");
check(!held.ready && held.blocked, "…and is reported as blocked, not as incomplete");
check(!held.ready && held.blockReason === "Sold at 20% off.", "…with the reason it was held, so they are not left guessing");

// A hold is not cured by filling in a form. Only a person lifts it.
check(!supporterReadiness({ ...complete, supporter_blocked_at: "2026-08-05T00:00:00Z" } as never).ready,
  "a COMPLETE profile does not unlock an account that was put on hold");

// ── Nothing at all ────────────────────────────────────────────────────────
for (const empty of [null, undefined, {}]) {
  const r = supporterReadiness(empty as never);
  check(!r.ready, `${JSON.stringify(empty)} → not ready (never fails open)`);
}

// Either a personal name or a business name will do — a shop trading under one
// name and a person trading under their own are both real vendors.
check(supporterReadiness({ ...complete, full_name: "" } as never).ready, "a business name alone is enough");
check(supporterReadiness({ ...complete, business_name: "" } as never).ready, "a personal name alone is enough");
check(!supporterReadiness({ ...complete, full_name: "", business_name: "" } as never).ready, "…but not neither");

// Whitespace is not an address. " " in a field would otherwise pass silently
// and put a blank line on a GST invoice.
check(!supporterReadiness({ ...complete, phone: "   " } as never).ready, "spaces do not count as a phone number");

console.log(fails === 0 ? "PASS  supporter readiness: every requirement stated with its reason, hold outranks all, never fails open" : "");
process.exit(fails === 0 ? 0 : 1);
