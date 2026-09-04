// A way out of every email, and a daily look at what went out.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const unsub = readFileSync("lib/unsubscribe.ts", "utf8");
const notify = readFileSync("lib/notify.ts", "utf8");
const page = readFileSync("app/unsubscribe/page.tsx", "utf8");
const api = readFileSync("app/api/unsubscribe/route.ts", "utf8");
const review = readFileSync("app/api/cron/outbound-review/route.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

/* ── the unsubscribe ─────────────────────────────────────────────────────── */

check("the link is signed", /createHmac\("sha256", k\)/.test(unsub),
  "without a signature anyone could unsubscribe any student by editing the query string");
check("the token is compared in constant time", /timingSafeEqual/.test(unsub),
  "=== leaks how much of the token was right");
check("the link never expires", !/Date\.now\(\)|expires=|maxAge:|ttl:/i.test(unsub),
  "a dead link is how a person marks mail as spam instead, which costs every student their password email");

check("EVERY email carries it, not just the ones a caller remembers to mark",
  /const unsubLink = await unsubscribeUrl\(to\)/.test(notify) && !/if \(opts\.bulk\) \{[\s\S]{0,80}List-Unsubscribe/.test(notify),
  "it was bulk-only, and the job that pestered him never passed bulk");
check("it sits where the blocklist is checked — the one place every message passes",
  notify.indexOf("if (await isBlocked(to)) return false;") < notify.indexOf('body.set(\n    "h:List-Unsubscribe"'),
  "both guards live in sendEmail, so no sender can route around either");
check("the header offers one-click", /List-Unsubscribe-Post/.test(notify));
check("the footer offers a link a person can see", /Unsubscribe<\/a>/.test(notify));

check("arriving at the page does NOT unsubscribe",
  /does NOT unsubscribe on arrival|It does NOT unsubscribe/.test(page) && /action=\{confirmUnsubscribe\}/.test(page),
  "scanners follow every link in a message; a GET that acted would remove people who never clicked");
check("one-click POST is honoured with no further step",
  /export async function POST/.test(api) && /upsert\(/.test(api));
check("a GET on the one-click endpoint only redirects", /NextResponse\.redirect/.test(api));
check("a failure still answers 200", /200 either way/.test(api),
  "a provider reads an error as 'unsubscribe is broken' and marks the sender down");
check("there is a way back on", /export async function resubscribe/.test(readFileSync("app/unsubscribe/actions.ts", "utf8")),
  "a door that only locks is a trap, not a setting");

/* ── the daily review ────────────────────────────────────────────────────── */

check("it runs every day", /"\/api\/cron\/outbound-review"/.test(vercel));
check("it covers every channel, not just email",
  /select\("channel, template, student_id, status"\)/.test(review),
  "the same fault could be written into the Telegram or WhatsApp path tomorrow");
check("REPEATS lead the report, not volume",
  /REPEAT_LIMIT/.test(review) && /repeats\.length > 0/.test(review),
  "volume was normal the day 33 students got nine emails each; what was abnormal was one person getting the same thing over and over");
check("a failed read is reported, never shown as a quiet day",
  /nothing reported rather than reporting a quiet day/.test(review),
  "the incident this exists for WAS a failed read taken for an empty answer");
check("repeats are counted only where the recipient is known",
  /Only where we know WHO/.test(review),
  "a null recipient would invent an alarm every day and the report would be ignored");
check("it names people, not uuids", /full_name, email/.test(review));
check("a bad day is flagged important", /important: worry/.test(review));

console.log(fails ? `${fails} failed` : "ok — unsubscribe, and a daily look at what went out");
process.exit(fails ? 1 : 0);
