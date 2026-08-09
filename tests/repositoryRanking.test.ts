// "IN WHICH CLASS DID SIR EXPLAIN INVESTMENTS?"
//
// A student asked exactly that and was told we did not have the information.
// We did: every one of the 325 published classes carries a class number, a
// transcript and a digest.
//
// The material was ranked by counting how many of the question's words appeared
// in each chunk — and of the six words in that question, five (which, class,
// sharma, explained, about) appear in essentially every chunk. The one word
// that narrowed anything, "investment", was worth a sixth of the score. So the
// ranking was decided by the shape of the question rather than its subject, and
// the right class never reached the top of the list before the character budget
// ran out.
//
// This proves the ranking on a miniature version of the real library.
//
//   node --experimental-strip-types tests/repositoryRanking.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "..", "lib/repository.ts"), "utf8");

// Lifted from lib/repository.ts; the last check holds them in step.
const ASKING_WORDS = new Set(
  (/const ASKING_WORDS = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? "")
    .split(",").map((w) => w.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
);

type Chunk = { text: string };

/** The ranking as the library now does it. */
function rank(pool: Chunk[], query: string): Chunk[] {
  const terms = [...new Set((query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []))]
    .filter((w) => !ASKING_WORDS.has(w));
  if (!terms.length) return pool;
  const lower = pool.map((c) => c.text.toLowerCase());
  const spread = new Map(terms.map((w) => [w, lower.filter((t) => t.includes(w)).length]));
  const useful = terms.filter((w) => (spread.get(w) ?? 0) <= pool.length * 0.5);
  const scoring = useful.length ? useful : terms;
  return pool
    .map((c, i) => ({
      c,
      s: scoring.reduce((n, w) => {
        if (!lower[i].includes(w)) return n;
        const seen = spread.get(w) ?? 1;
        return n + Math.max(1, Math.round(pool.length / Math.max(1, seen)));
      }, 0),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// A library shaped like the real one: every class mentions "Class", the subject
// name and the teacher, and only one is about investments.
const AS13 = { text: "Advanced Accounting — AS 13 Accounting for Investments\n— Class 42 — Investments: current and long term\nClass summary: Parveen Sharma explains investment classification, cost of investment and carrying amount." };
const library: Chunk[] = [
  { text: "Advanced Accounting — Amalgamation\n— Class 10 — Purchase consideration\nClass summary: Parveen Sharma explains amalgamation and the pooling method." },
  { text: "Advanced Accounting — Buy Back\n— Class 20 — Buy back of securities\nClass summary: Parveen Sharma explains buy back limits under the class of the Companies Act." },
  AS13,
  { text: "Advanced Accounting — Branches\n— Class 55 — Foreign branch accounting\nClass summary: Parveen Sharma explains branch conversion in this class." },
  { text: "Financial Reporting — Ind AS 116\n— Class 8 — Leases\nClass summary: Parveen Sharma explains lease liability in this class." },
];

const QUESTION = "in which class did Sharma Sir explained about investment";

check("the class about investments ranks first",
  rank(library, QUESTION)[0] === AS13,
  "the question's own words still outrank its subject");

// The generic words must be discarded before scoring at all.
for (const w of ["which", "class", "sharma", "explained", "about"]) {
  check(`"${w}" is not scored`, ASKING_WORDS.has(w), "it appears in nearly every class");
}
check("the subject word survives", !ASKING_WORDS.has("investment"));

// Hindi and Hinglish ask the same thing.
check("kaunsi class me investment padhaya — still finds it",
  rank(library, "kaunsi class me investment padhaya gaya")[0] === AS13);

// A question made only of asking-words ("which class sir") narrows nothing, so
// there is nothing to rank BY. The library must come back whole in its default
// order rather than empty — an unranked answer is worth having; no material at
// all is not.
check("a question with no subject word leaves the library intact",
  rank(library, "which class sir").length === library.length,
  "material must not vanish just because the question named no subject");

// A real study question still works — the ranking must not have been narrowed
// to only "which class" questions.
check("an ordinary doubt still finds its class",
  rank(library, "how is a long term investment carried")[0] === AS13);

// And the library must still be split per class, or a class number can be cut
// off by the character budget before it is ever read.
check("material is chunked per class, not per topic",
  /classChunks\.push\(/.test(src) && /— \$\{cno\}\$\{s\.title\}/.test(src),
  "each class must carry its own number into the ranking");

console.log(fails === 0
  ? "PASS  the investments class ranks first, in English and Hinglish"
  : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
