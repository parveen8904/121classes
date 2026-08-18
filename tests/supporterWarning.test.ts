import { decideWarning } from "../lib/supporterWarn";

// WARNING ONE, TWO, THREE — AND WHAT MUST NOT COUNT AS A REPEAT.
//
// The founder's instruction on 18 August was a month with no holds: tell the
// vendor what we found, tell them we are aware, ask them not to repeat it, and
// bring a third warning to the office rather than blocking anybody.
//
// The trap is the calendar. The reader comes round every night and a shop page
// takes days to change — somebody has to ring their web person. If each nightly
// read counted as a fresh offence, a vendor warned on Monday would be at the
// office's door by Wednesday having done nothing wrong in between. That is the
// opposite of giving people time, so it is the thing tested hardest here.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

const DAY = 86_400_000;
const now = new Date("2026-08-20T03:00:00+05:30");
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
const FINDING = { problem: "discount", url: "https://shop.example/store" };

// ── The first one ────────────────────────────────────────────────────────
const first = decideWarning([], FINDING, now);
check(first.send && first.number === 1 && !first.escalate, "a first finding is warning 1, and escalates nothing");

// ── The same page, read again tonight ────────────────────────────────────
const sameNight = decideWarning(
  [{ problem: "discount", url: "https://shop.example/store", sent_at: ago(1) }], FINDING, now);
check(!sameNight.send, "the same page a day later is NOT a second warning — they are still fixing it");

const sameWeek = decideWarning(
  [{ problem: "discount", url: "https://shop.example/store", sent_at: ago(6) }], FINDING, now);
check(!sameWeek.send, "…nor six days later");

const stillThere = decideWarning(
  [{ problem: "discount", url: "https://shop.example/store", sent_at: ago(8) }], FINDING, now);
check(stillThere.send && stillThere.number === 2, "a week on and still uncorrected IS warning 2");

// ── A different problem, or a different page, is a fresh matter ──────────
const elsewhere = decideWarning(
  [{ problem: "discount", url: "https://shop.example/store", sent_at: ago(1) }],
  { problem: "discount", url: "https://shop.example/final-combo" }, now);
check(elsewhere.send && elsewhere.number === 2, "the same fault on a different page is a new warning");

const otherRule = decideWarning(
  [{ problem: "discount", url: "https://shop.example/store", sent_at: ago(1) }],
  { problem: "combo", url: "https://shop.example/store" }, now);
check(otherRule.send && otherRule.number === 2, "a different rule broken on the same page is a new warning");

// ── The third ────────────────────────────────────────────────────────────
const third = decideWarning([
  { problem: "discount", url: "https://shop.example/a", sent_at: ago(30) },
  { problem: "combo", url: "https://shop.example/b", sent_at: ago(20) },
], FINDING, now);
check(third.send && third.number === 3 && third.escalate,
  "the third warning is still sent to the vendor — and put to the office as well");

// It stays a question after that. Nothing here ever blocks; only a person does.
const fourth = decideWarning([
  { problem: "discount", url: "https://shop.example/a", sent_at: ago(40) },
  { problem: "combo", url: "https://shop.example/b", sent_at: ago(30) },
  { problem: "discount", url: "https://shop.example/c", sent_at: ago(20) },
], FINDING, now);
check(fourth.send && fourth.number === 4 && fourth.escalate, "a fourth is warned and escalated, never held");

console.log(fails === 0 ? "supporterWarning: all checks passed" : `supporterWarning: ${fails} FAILED`);
if (fails) process.exitCode = 1;
