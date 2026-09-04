// Nobody gets the same unasked-for email nine times.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const stuck = readFileSync("app/api/cron/stuck-at-signup/route.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

check("the job is off the schedule",
  !/stuck-at-signup/.test(vercel),
  "it ran three times a day and sent 1,701 emails to 1,188 people");
check("and it will not send even if called",
  /params\.get\("send"\) !== "1"/.test(stuck),
  "sending is now a deliberate act by a person, never a timer");

/* ── the defect that let it happen ───────────────────────────────────────── */

check("who-has-already-had-one is read in chunks",
  /inChunks\(ids, \(batch\)/.test(stuck),
  "one .in() over a thousand ids builds a URL PostgREST refuses — and it answers with NOTHING rather than an error, so the cap read 'nobody has had one'");
check("a failed read stops the job instead of licensing it",
  /catch \{ countedOk = false; \}/.test(stuck) && /\|\| !countedOk/.test(stuck),
  "not knowing who has already been written to is exactly when you must not write to anyone");
check("the run says whether it could count",
  /counted: countedOk/.test(stuck),
  "a cap that silently failed is what made this invisible for three weeks");
check("the two-is-enough rule is still there for if it is ever used by hand",
  /already >= 2\) return false/.test(stuck));

/* ── the sender everyone must pass ───────────────────────────────────────── */

const notify = readFileSync("lib/notify.ts", "utf8");
check("a blocked address is refused at the one place every message passes",
  /if \(await isBlocked\(to\)\) return false;/.test(notify),
  "aimed at no particular sender, so next year's cron cannot bypass it");
check("bulk mail carries List-Unsubscribe",
  /h:List-Unsubscribe/.test(notify));

console.log(fails ? `${fails} failed` : "ok — no unsolicited repeat mail");
process.exit(fails ? 1 : 0);
