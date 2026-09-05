// Who the re-engagement letter goes to, and why a return build failed.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const re = readFileSync("lib/reengage.ts", "utf8");
const act = readFileSync("app/admin/zoho/itr/actions.ts", "utf8");
const page = readFileSync("app/admin/zoho/itr/page.tsx", "utf8");

/* ── "your first class is waiting" must not go to enrolled students ──────── */

check("anyone already enrolled is excluded",
  /const enrolled = new Set\(/.test(re) && /\.in\("status", \["active", "blocked"\]\)/.test(re),
  '619 of 1,872 who received it held an ACTIVE subscription; one had access to 2028 and was sent it three times');
check("the exclusion is applied to BOTH rungs",
  (re.match(/&& !enrolled\.has\(p\.id\)/g) ?? []).length === 2,
  "day 3 and day 7 are separate filters; fixing one would leave the other");
check("people who have watched something are still excluded",
  /!watched\.has\(p\.id\)/.test(re));
check("the ladder still never repeats a rung",
  /!sent\.has\(`\$\{p\.id\}:never_started_d7`\)/.test(re));

/* ── a return build that fails must say why ──────────────────────────────── */

check("the build no longer throws into the void",
  /pack = await buildReturn\(fy\);\s*\n\s*\} catch \(e\) \{/.test(act),
  "a server action that throws gives back an unexplained error and an unchanged page");
check("the reason is carried back to the page",
  /could not be built: \$\{why\}/.test(act) && /sp\.err &&/.test(page));
check("a success says so too", /&built=1/.test(act) && /sp\.built &&/.test(page));

/* ── and an unbuilt year points at the years that exist ──────────────────── */

check("the empty state names the dates it would read",
  /it reads Zoho&apos;s profit &amp; loss and balance sheet for \{from\} to \{to\}/.test(page));
check("…and links the years already built",
  /builtYears\.length > 0/.test(page) && /Already built:/.test(page),
  "it opens on 2025-26, which had never been built, while 2026-27 had");

console.log(fails ? `${fails} failed` : "ok — the letter skips enrolled students, and a failed build explains itself");
process.exit(fails ? 1 : 0);
