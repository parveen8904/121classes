// WHAT NUMBER IS THIS?
//
// 3 September 2026. Counting WhatsApp sends for the Meta pricing question threw
// up eight messages in sixty days addressed to COUNTRY CODE ZERO — numbers a
// student had typed the way an Indian mobile is written at home, 09876543210,
// with the trunk prefix in front. Meta's API accepted the call, so our own log
// recorded them as "sent". They cannot have arrived, and nothing would ever
// have said so.
//
// The rule lived in four places. Three of them — the WhatsApp sender, the OTP,
// the login rescue — were wrong in exactly the same way, each a one-liner
// saying "ten digits gain 91, anything longer already carries a code". The
// fourth, lib/leadParse.ts, had handled the leading zero correctly all along.
// The office had the right answer written down, in the one file nobody sending
// a message ever read.
//
//   node --experimental-strip-types tests/phoneNumber.test.ts

import { toE164Digits, phoneTail } from "../lib/phoneNumber.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};
const is = (input: string, want: string) =>
  check(`${input || "(empty)"} → ${want || "(nothing)"}`, toE164Digits(input) === want, `got ${toE164Digits(input) || "(nothing)"}`);

// ── the bug ────────────────────────────────────────────────────────────────
// Every one of these was being sent to country code 0.
is("09876543210", "919876543210");
is("07876543210", "917876543210");
is("0 98765 43210", "919876543210");
is("+0091 98765 43210", "919876543210");
is("00919876543210", "919876543210");

// ── what already worked, and must go on working ────────────────────────────
is("9876543210", "919876543210");          // the ordinary case
is("919876543210", "919876543210");        // already carries the code
is("+91 98765 43210", "919876543210");     // written out
is("+91-98765-43210", "919876543210");
is("(+91) 98765 43210", "919876543210");

// Real foreign numbers seen in the log — none of these may be touched.
is("15551234567", "15551234567");          // +1, United States
is("447700900123", "447700900123");        // +44, United Kingdom
is("9779812345678", "9779812345678");      // +977, Nepal

// ── refusing, rather than guessing ─────────────────────────────────────────
// The old code returned whatever digits it had, and the callers' own
// "length < 11" guard was all that stood between a typo and a send.
is("", "");
is("abc", "");
is("12345", "");                            // too short to be anything
is("0", "");
is("000", "");
is("1234567890123456", "");                 // longer than E.164 allows

check("a number it cannot read is refused, never guessed at", (() => {
  for (const junk of ["", "   ", "+", "-", "()", "12345", "0", "98765"]) {
    if (toE164Digits(junk) !== "") return false;
  }
  return true;
})(), "sending to a guess is worse than not sending");

check("nothing ever comes back starting with a zero", (() => {
  for (const v of ["09876543210", "00919876543210", "0 0 9876543210", "0000009876543210"]) {
    const out = toE164Digits(v);
    if (out.startsWith("0")) return false;
  }
  return true;
})(), "no country calling code begins with 0, so a leading zero is always wrong");

// ── matching is a different job, and stays generous ────────────────────────
check("the three ways of writing one number all match each other",
  phoneTail("9876543210") === phoneTail("919876543210") &&
  phoneTail("919876543210") === phoneTail("09876543210") &&
  phoneTail("09876543210") === "9876543210");

// ── and the four copies are now one ────────────────────────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
for (const f of ["lib/notify.ts", "lib/phoneVerify.ts", "lib/loginRescue.ts"]) {
  const src = read(f);
  check(`${f} uses the shared rule`, /toE164Digits/.test(src));
  check(`${f} no longer keeps its own copy`,
    !/length === 10\) return `91|length === 10 \? `91/.test(src),
    "three separate one-liners is how three of them came to be wrong in the same way");
}

console.log(fails === 0 ? "ok — phone numbers" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
