// The US income sheet, for any period, from both people's books.
import { fySplitInside, monthsBetween } from "../lib/usComputation.ts";
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const lib = readFileSync("lib/usComputation.ts", "utf8");
const route = readFileSync("app/admin/zoho/tax/us/route.ts", "utf8");

/* ── the split that exists because two countries disagree about the year ─── */

check("a US calendar year is split on 1 April",
  fySplitInside("2025-01-01", "2025-12-31") === "2025-04-01",
  "Jan–Mar is the tail of one Indian year and Apr–Dec the head of the next");
check("a period inside one Indian year is NOT split",
  fySplitInside("2025-05-01", "2025-12-31") === null);
check("a period ending on 31 March is not split", fySplitInside("2025-01-01", "2025-03-31") === null);
check("a period starting exactly on 1 April is not split", fySplitInside("2025-04-01", "2025-12-31") === null);
check("a period spanning two years splits on the first April it meets",
  fySplitInside("2024-06-01", "2025-12-31") === "2025-04-01");

check("the months of a period are enumerated",
  monthsBetween("2025-01-01", "2025-12-31").length === 12
    && monthsBetween("2025-01-01", "2025-12-31")[0] === "2025-01");
check("a part-month still counts", monthsBetween("2025-01-15", "2025-02-03").join() === "2025-01,2025-02");

/* ── the conversion ──────────────────────────────────────────────────────── */

check("one rate per MONTH, not one per year",
  /ttBuyRate\(lastDay, "USD"\)/.test(lib),
  "over a year the rupee moved 86 to 89; a single average would be wrong by lakhs");
check("it is the same SBI TT source the rest of the codebase uses",
  /await import\("@\/lib\/forexRates"\)/.test(lib),
  "so a figure here cannot disagree with the brokerage journals");
check("rupees are DIVIDED by the rate",
  /r\.amount \/ rate/.test(lib), "the rate is rupees per dollar; multiplying would be out by 7,900×");
check("a month with no rate is reported, not silently averaged over",
  /No SBI TT buying rate is on file for/.test(lib));
check("no rate at all refuses outright",
  /No exchange rate could be read for any month/.test(lib));

/* ── both people, and neither silently missing ───────────────────────────── */

check("it reads every active entity", /listEntities\(\)/.test(lib));
check("an entity Zoho refuses is NAMED, not counted as earning nothing",
  /could not be read for \$\{m\}/.test(lib) && /Nothing of theirs is in this file/.test(lib),
  "a silent omission of one person's books is a wrong return");
check("the file separates the two people", /"By person"/.test(route));

/* ── and it refuses to invent the return ─────────────────────────────────── */

check("the 1040 is explicitly NOT computed",
  /What is NOT here/.test(route) && /None is guessed here/.test(route));
check("the capital-gains trap is spelt out",
  /including the capital gains, which the books understate/.test(route),
  "the 1099-Bs held $511,788 against the $55k the books implied");
check("a failure returns an error, never a spreadsheet of zeros",
  /status: 502/.test(route) && /A spreadsheet of zeros would be filed/.test(route));
check("every rate used is written into the file so a figure can be retraced",
  /"Exchange rates"/.test(route));

/* ── each month at its own rate, proved against his own workbook ─────────── */

check("the books are read a MONTH at a time",
  /plFor\(e\.slug, w\.from, w\.to\)/.test(lib) && /const w = monthWindow\(m\);/.test(lib),
  "a period average assumes the money arrived evenly through the year; it did not");
check("no half is converted at a mean of its months",
  !/rateFor\(/.test(lib) && !/const r1 = /.test(lib));
check("a month is placed in the right half of the US year",
  /const second = splitOn !== null && `\$\{m\}-01` >= splitOn;/.test(lib));
check("a partial first or last month is clipped to the period",
  /first < from \? from : first/.test(lib) && /last > to \? to : last/.test(lib),
  "asking for 15 Jan to 3 Feb must not pull the whole of January");
check("nothing of a failed entity is ever accumulated in the first place",
  lib.indexOf("if (failure) { notes.push(failure); continue; }") < lib.indexOf("for (const { m, rows } of perMonth)"),
  "every month is fetched before any is counted, so a half-read year cannot reach the file");

// His 2025 workbook: Sales-Parveen Sharma, Jan–Mar ₹2,27,14,643 → $265,134.54.
// A simple mean of Jan/Feb/Mar (86.20, 86.95, 85.10) is 86.0833 and gives
// $263,868 — $1,266 adrift on ONE ledger. Month-by-month is what closes it.
const mean = (86.2 + 86.95 + 85.1) / 3;
check("the mean of the three months is NOT the rate his figures imply",
  Math.abs(22714643 / mean - 265134.54) > 1000,
  "which is exactly why the period-average version disagreed with his workbook");

/* ── and it must not take so long the browser gives up ───────────────────── */

check("the months are fetched in parallel, bounded",
  /runBounded\(months, 4, async \(m\)/.test(lib),
  "twelve reports per person one after another is ninety seconds of a blank tab");
check("the bound is a real worker pool, not a fire-and-hope",
  /const i = next\+\+;\s*\n\s*if \(i >= items\.length\) return;/.test(lib));
check("a month that fails still fails the whole entity",
  /failure \?\?= /.test(lib) && /if \(failure\) \{ notes\.push\(failure\); continue; \}/.test(lib),
  "half a person's year is worse than none of it");
check("the page warns that it takes a moment",
  /takes around half a minute/.test(readFileSync("app/admin/zoho/tax/page.tsx", "utf8")),
  "a form that downloads gives no feedback, so a slow one looks broken");

/* ── the file opens on the return, as his workbook does ─────────────────── */

check("there is a Computation 1040 sheet",
  /"Computation 1040"/.test(route), '"my excel has a sheet 1040"');
check("it is added FIRST, before the ledgers",
  route.indexOf('"Computation 1040"') < route.indexOf('"Income Details"'),
  "his workbook opens on the answer and the workings follow it");
check("it uses the same computation as the screen",
  /compute1040, INPUT_KEYS/.test(route),
  "two implementations of one tax return is two answers");
check("only a calendar year gets one",
  /pack\.from\.slice\(0, 4\) === pack\.to\.slice\(0, 4\)/.test(route),
  "a 1040 for March-to-August is not a thing");
check("a year with no figures says so instead of printing zeros",
  /not drawn/.test(route) && /would be filed/.test(route));
check("the bands are in the file too, so line 16 is checkable on paper",
  /HOW THE TAX ON LINE 16 IS MADE/.test(route));

console.log(fails ? `${fails} failed` : "ok — the US income sheet builds for any period");
process.exit(fails ? 1 : 0);
