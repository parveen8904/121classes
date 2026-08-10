import { passwordProblem, friendlyPasswordError, PASSWORD_RULE } from "../lib/passwordRule";

// THE LOOP THIS EXISTS TO END.
//
// A student wrote in: "not able to create password, it keeps saying at least 8
// character". Their password was already longer than eight. Supabase had
// refused it for lacking a capital, a digit or a symbol — and its message says
// "should contain at least one character of each: …". The form matched the word
// "char" and rewrote that into "Use at least 8 characters."
//
// So they added characters. It failed again. There is no length at which
// `mypassword` starts working, and nothing on the screen ever said why.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── The exact message that caused it ───────────────────────────────────────
const supabaseVariety =
  "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, " +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};':\"|<>?,./`~.";
const answer = friendlyPasswordError(supabaseVariety);
check(!/at least 8 characters\.$/i.test(answer),
  "the variety error must NOT be answered with a length complaint — that is the whole bug");
check(/capital/i.test(answer) && /number/i.test(answer) && /symbol/i.test(answer),
  "the variety error must say what is actually needed");

// ── Told one thing at a time, in words they can act on ─────────────────────
check(/8 characters/.test(passwordProblem("Ab1!") ?? ""), "too short is reported as too short");
check(/small letter/i.test(passwordProblem("ABCD1234!") ?? ""), "a missing small letter is named");
check(/CAPITAL/.test(passwordProblem("abcd1234!") ?? ""), "a missing capital is named");
check(/number/i.test(passwordProblem("abcdEFGH!") ?? ""), "a missing number is named");
check(/symbol/i.test(passwordProblem("abcdEFGH1") ?? ""), "a missing symbol is named");
check(passwordProblem("Study@2026") === null, "a password that meets the rule is accepted");
check(passwordProblem("aB3$xyzw") === null, "eight characters with all four kinds is enough");

// The student's own case: long, but all lower case. It must NOT be answered
// with anything about length.
const theirs = passwordProblem("mypasswordislong");
check(theirs !== null, "an all-lowercase password is still refused");
check(!/8 characters/.test(theirs ?? ""), "…but never for its length — it is sixteen characters long");
check(/CAPITAL/.test(theirs ?? ""), "…it is refused for the reason that is actually true");

// ── Over-long, which Supabase caps at 72 ───────────────────────────────────
check(/too long/i.test(passwordProblem("Ab1!" + "x".repeat(80)) ?? ""), "over 72 characters is refused before the server does");

// ── The other server answers still read properly ───────────────────────────
check(/data breach/i.test(friendlyPasswordError("Password is known to be weak and easy to guess (pwned)")),
  "a breached password is explained as breached");
check(friendlyPasswordError("aal2 required") === "__MFA__", "the two-factor signal survives");
check(/8 characters/.test(friendlyPasswordError("Password should be at least 8 characters")),
  "a genuine length error is still a length error");

// ── The rule shown on the form must match what is enforced ─────────────────
check(/8/.test(PASSWORD_RULE) && /capital/i.test(PASSWORD_RULE) && /number/i.test(PASSWORD_RULE) && /symbol/i.test(PASSWORD_RULE),
  "the sentence shown to students must state every rule that is enforced");

console.log(fails === 0 ? "PASS  password rule: variety is never reported as length, and each fault is named" : "");
process.exit(fails === 0 ? 0 : 1);
