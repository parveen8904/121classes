import { shouldDraft, type PriorWarning } from "../lib/supporterWarn";

// WHAT THE NIGHTLY READ IS ALLOWED TO PUT IN FRONT OF A PERSON.
//
// The founder's instruction of 18 August: the machine does not hold and does
// not write to vendors. It says "here is a fault", the office checks it, and
// only then does the mail go. Everything the machine still decides on its own
// is therefore about the OFFICE'S time, not the vendor's money — and it comes
// down to one question: is tonight's finding worth raising again?
//
// Two ways to get that wrong, both tested below. Raise the same thing every
// night and the queue becomes noise nobody reads, which is how a real breach
// gets missed. Raise it never, and a shop that was warned in March and ignored
// it is never mentioned again.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

const DAY = 86_400_000;
const now = new Date("2026-08-20T03:00:00+05:30");
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
const FINDING = { problem: "discount", url: "https://shop.example/store" };
const prior = (over: Partial<PriorWarning>): PriorWarning => ({
  problem: "discount", url: "https://shop.example/store", status: "sent", sent_at: ago(1), ...over,
});

// ── A first finding always reaches the office ────────────────────────────
check(shouldDraft([], FINDING, now).draft, "a fault nobody has seen is put to the office");

// ── Already in the queue ─────────────────────────────────────────────────
const queued = shouldDraft([prior({ status: "pending", sent_at: ago(3) })], FINDING, now);
check(!queued.draft && queued.reason === "already queued",
  "the same fault already waiting for a decision is not raised twice");

// ── Already put to the vendor ────────────────────────────────────────────
check(!shouldDraft([prior({ status: "sent", sent_at: ago(2) })], FINDING, now).draft,
  "a page the seller was written to about two days ago is left alone — they are fixing it");
check(shouldDraft([prior({ status: "sent", sent_at: ago(9) })], FINDING, now).draft,
  "…but nine days on and still uncorrected is worth raising again");

// ── A dismissed draft is not a warning ───────────────────────────────────
// The office looked and said this was not a fault. That must not silently
// suppress the finding for a week as if the seller had been told.
check(shouldDraft([prior({ status: "dismissed", sent_at: ago(1) })], FINDING, now).draft,
  "a finding the office threw away yesterday can be raised again");

// ── A different page, or a different rule, is a different matter ─────────
check(shouldDraft([prior({ status: "pending" })], { problem: "discount", url: "https://shop.example/combo" }, now).draft,
  "the same fault on another page is its own finding");
check(shouldDraft([prior({ status: "pending" })], { problem: "combo", url: "https://shop.example/store" }, now).draft,
  "a different rule broken on the same page is its own finding");

// ── The numbering rule, stated where it can be read ──────────────────────
// The number a vendor sees is counted at SENDING, from warnings actually sent —
// never from drafts. Nothing here assigns one, which is the point: a draft that
// is thrown away must not use up "warning 2" for somebody who was written to
// once. The count itself lives in sendDraftedWarning, against the database.
const history: PriorWarning[] = [
  prior({ status: "dismissed", sent_at: ago(40) }),
  prior({ status: "sent", sent_at: ago(30), url: "https://shop.example/a" }),
  prior({ status: "pending", sent_at: ago(2), url: "https://shop.example/b" }),
];
check(shouldDraft(history, { problem: "combo", url: "https://shop.example/c" }, now).draft,
  "a fresh fault is raised whatever else is in their history");

console.log(fails === 0 ? "supporterWarning: all checks passed" : `supporterWarning: ${fails} FAILED`);
if (fails) process.exitCode = 1;
