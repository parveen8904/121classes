import { replySubject, replyDepth } from "../app/api/email/inbound/route";

// THE SUBJECT LINE WAS KEEPING COUNT AND NOBODY READ IT.
//
// Anshu Bansal got three emails in ten minutes on 11 August:
//   17:25  Re: Re: Your first class is waiting
//   17:30  Re: Re: Re: Your first class is waiting
//   17:36  Re: Re: Your first class is waiting
//
// Our re-engagement mail went out, something replied to it, and the inbound
// handler answered with `Re: ${subject}` — unconditionally, whatever the
// subject already was. So every turn grew another prefix, and the loop
// advertised itself in the one place nothing was looking.
//
// Two rules now. A reply carries exactly one "Re:". And an arriving subject
// with two or more is a loop by definition — stopped on the second turn, not
// the seventh.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── Exactly one Re:, however many arrived ────────────────────────────────
check(replySubject("Your first class is waiting", "x") === "Re: Your first class is waiting", "a plain subject gains one Re:");
check(replySubject("Re: Your first class is waiting", "x") === "Re: Your first class is waiting", "one Re: stays one");
check(replySubject("Re: Re: Your first class is waiting", "x") === "Re: Your first class is waiting", "two collapse to one");
check(replySubject("Re: Re: Re: Your first class is waiting", "x") === "Re: Your first class is waiting", "three collapse to one — the exact case that happened");
check(replySubject("RE: RE: shouting", "x") === "Re: shouting", "case does not matter");
check(replySubject("Fwd: Re: mixed", "x") === "Re: mixed", "a forward in the chain is stripped too");
check(replySubject("re:re:re:no spaces", "x") === "Re: no spaces", "no spaces between them still collapses");
check(replySubject("", "Your question") === "Your question", "an empty subject uses the fallback");
check(replySubject("Re: ", "Your question") === "Your question", "a subject that is ONLY Re: falls back rather than sending \"Re: \"");

// Other languages loop too. A German or Spanish client is not a special case.
for (const p of ["AW:", "SV:", "Antw:", "RES:", "WG:", "TR:"]) {
  check(replySubject(`${p} hello`, "x") === "Re: hello", `${p} is recognised as a reply prefix`);
}
// Outlook's numbered form.
check(replySubject("Re[2]: hello", "x") === "Re: hello", "Re[2]: is recognised");

// ── The depth that decides ───────────────────────────────────────────────
check(replyDepth("Your first class is waiting") === 0, "a fresh subject has depth 0");
check(replyDepth("Re: Your first class is waiting") === 1, "one reply is depth 1 — a person answering, allowed");
check(replyDepth("Re: Re: Your first class is waiting") === 2, "two is depth 2 — our reply came back, stopped");
check(replyDepth("Re: Re: Re: Your first class is waiting") === 3, "three is depth 3");
check(replyDepth("Fwd: Re: x") === 2, "a forward counts toward the depth");

// The threshold itself: 1 must pass, 2 must not.
check(replyDepth("Re: anything") < 2, "a normal reply is NOT treated as a loop");
check(replyDepth("Re: Re: anything") >= 2, "the second turn IS — before seven emails have gone out");

// ── The subject can never grow again ─────────────────────────────────────
// Whatever comes in, applying the rule twice changes nothing. That is the
// property the old code lacked, and the whole loop followed from it.
for (const start of ["hello", "Re: hello", "Re: Re: hello", "Fwd: Re: Re: hello", "RE:RE: hello"]) {
  const once = replySubject(start, "f");
  const twice = replySubject(once, "f");
  check(once === twice, `"${start}" is stable — replying to our own reply does not lengthen it`);
}

console.log(fails === 0 ? "PASS  email loop: one Re: only, stable under repetition, second turn stops the machine" : "");
process.exit(fails === 0 ? 0 : 1);
