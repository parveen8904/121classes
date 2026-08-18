import { inspectSite } from "../lib/supporterSite";

// WHOSE DISCOUNT IS IT? — THE QUESTION THAT COST THREE VENDORS ₹5,000 EACH.
//
// The nightly reader fines a vendor for discounting our course by more than
// 5%. It used to search the whole page for "N% off" and hold the account on
// the first one it found, without ever asking whose course the offer was on.
//
// A reseller's store lists thirty courses by a dozen teachers. There is ALWAYS
// a discount on such a page. So on 15 August it fined LLA Edutech for CA
// Rishabh Jain's audit course, TUVIJAT for CA Aarish Khan's DT/IDT combo, and
// Aldine — the founder's own company — on its own homepage.
//
// The strings below are the real evidence it stored for those three holds.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

function serve(html: string) {
  (globalThis as unknown as { fetch: unknown }).fetch = async (u: string | URL) =>
    String(u).includes("sitemap") ? new Response("", { status: 404 }) : new Response(html, { status: 200 });
}

const read = async (body: string) => {
  serve(`<html><body>${body}</body></html>`);
  return inspectSite("https://shop.example/");
};

// ── THE THREE REAL HOLDS, WHICH MUST NOT HAPPEN AGAIN ────────────────────
const LLA = `Sort by CA Final | FR | Regular | CA Aakash Kandoi Rs.11,999 CA Inter Audit Regular
  By CA Rishabh Jain 10% off 10000 Swapnil Patni Classes CA Inter Advanced Accounts Full Course
  By CA Anand Bhangariya 12500 CA Final | IDT |`;
check((await read(LLA)).ok,
  "another faculty's 10% off is not our vendor's breach (LLA Edutech, held 15 Aug)");

const TUVIJAT = `DT &amp; IDT(Center Batch) quantity Add to cart Category: CA Final Combo Group 2
  Description Special Combo with 25% Discount for FINAL Group-2 CA Final-Direct Taxation (DT)
  by CA Aarish Khan Live @ Home Online Classes`;
check((await read(TUVIJAT)).ok,
  "a 25% discount on another teacher's DT/IDT combo is not ours to police (TUVIJAT, held 15 Aug)");

// The subject name alone identifies nothing — every faculty teaches it. This is
// the exact trap in the LLA page: "Advanced Accounts by CA Anand Bhangariya".
check((await read("CA Inter Advanced Accounting by CA Anand Bhangariya — 20% off this week")).ok,
  "our SUBJECT taught by somebody else, discounted, is not our vendor's breach");

// ── AND THE BREACH ITSELF, WHICH MUST STILL BE CAUGHT ────────────────────
const REAL = `CA Final Financial Reporting Regular Batch by CA Parveen Sharma — 20% off,
  now Rs.9,999. Buy now.`;
const caught = await read(REAL);
check(!caught.ok && caught.problem === "discount",
  "20% off OUR course is still caught");
check(String(caught.evidence ?? "").includes("Parveen"),
  "…and the evidence quotes the page, so a person can check it");

const near = await read(`CA Parveen Sharma Advanced Accounting Regular Batch. ${"filler ".repeat(20)} 15% off`);
check(!near.ok && near.problem === "discount", "his name a few lines above the offer still counts");

const far = await read(`CA Parveen Sharma Advanced Accounting. ${"filler ".repeat(400)} 30% off Tally course`);
check(far.ok, "an offer far down a long page, nowhere near his name, does not count");

// 5% is the agreement, so 5% is allowed and 6% is not.
check((await read("CA Parveen Sharma FR Regular — 5% off")).ok, "exactly 5% off is allowed");
check(!(await read("CA Parveen Sharma FR Regular — 6% off")).ok, "6% off is not");

// ── The rule that outranks everything ────────────────────────────────────
(globalThis as unknown as { fetch: unknown }).fetch = async () => new Response("down", { status: 503 });
const down = await inspectSite("https://shop.example/");
check(!down.ok && down.problem === "unreachable", "a site that is down is never a breach");

console.log(fails === 0 ? "supporterSiteDiscount: all checks passed" : `supporterSiteDiscount: ${fails} FAILED`);
if (fails) process.exitCode = 1;
