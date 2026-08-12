// The guard that failed, reproduced. The stored question keeps the "Re: "
// prefix; the incoming subject has it stripped. A prefix match cannot bridge
// that, and this is the test that would have caught it before Anshu Bansal
// received two more replies.
const RE_PREFIX = /^((re|fwd|fw)\s*:\s*)+/i;
const key = (subject: string) => subject.replace(RE_PREFIX, "").trim().toLowerCase().slice(0, 120);

const stored = "Re: Your first class is waiting\n\nplease stop";
const incoming = "Re: Re: Your first class is waiting";

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { console.error(`FAIL ${what}`); fails++; } };

const k = key(incoming);
ok(k === "your first class is waiting", "prefixes stripped from the incoming subject");

// The OLD comparison — a prefix match. This is what shipped and never fired.
ok(stored.toLowerCase().startsWith(k) === false, "prefix match FAILS against stored text that keeps its Re:");

// The NEW comparison — anywhere in the string.
ok(stored.toLowerCase().includes(k) === true, "contains match succeeds, so the loop is caught");

// Bare first message must still match its own later replies.
ok("Your first class is waiting\n\nhello".toLowerCase().includes(k), "matches the un-prefixed original too");

// A genuinely different subject must NOT be suppressed.
ok("Re: Where are my books\n\n?".toLowerCase().includes(k) === false, "a different question still gets answered");

console.log(fails === 0
  ? "PASS  email loop: subject match ignores Re: on BOTH sides"
  : `FAIL  ${fails} case(s)`);
process.exit(fails === 0 ? 0 : 1);
