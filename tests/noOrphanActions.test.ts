// A BUTTON THAT DOES NOT EXIST.
//
// 3 September 2026. The accounts desk filed a supplier invoice in the vault and
// reported "there is no option to send for approval". Two faults sat behind it,
// and the second is the one this file is about: `scanBillsAction` — the code
// that turns a filed invoice into a bill — had existed since the desk was split
// into pages on 2 September, and NO PAGE EVER RENDERED IT. It was reachable by
// nobody. I then told the founder to press it, and he checked and told me it
// was not there.
//
// Splitting one 2,813-line page into thirteen dropped controls on the floor,
// quietly, because a server action nothing calls is not an error in TypeScript,
// not a lint failure, and not a broken build. It is simply a thing that cannot
// be done any more, discovered when somebody needs to do it.
//
// So: every exported server action must be rendered by some page or component,
// or be listed below with a reason. The list is the interesting half — it says
// which absences are decisions and which are debts.
//
//   node --experimental-strip-types tests/noOrphanActions.test.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const ROOT = join(import.meta.dirname, "..");
const ACTIONS = "app/admin/zoho/actions.ts";

/**
 * Actions with no caller ON PURPOSE, each with the reason.
 *
 * Adding a name here is a decision, not a formality: it says "this cannot be
 * done from the desk, and that is intended". Anything not on this list and not
 * rendered anywhere is a control somebody has lost.
 */
const DELIBERATE: Record<string, string> = {
  // His instruction, 2 September 2026: "remove razorpay clearing since bank
  // statement already includes". Every settlement carries a zero fee, so the
  // journal this queue made — Dr bank, Cr Razorpay Clearing — is exactly what
  // the bank line already posts. Two routes to one entry double-counted twice
  // in a fortnight. The page now says so in as many words: "Nothing posts from
  // here." These six must stay unreachable.
  approveSettlementAction: "retired 2 Sep — the bank statement is the only route to the deposit",
  approveAllSettlementsAction: "retired 2 Sep — as above",
  approveSelectedSettlementsAction: "retired 2 Sep — as above",
  skipSelectedSettlementsAction: "retired 2 Sep — as above",
  skipSettlementAction: "retired 2 Sep — as above",
  retrySettlementAction: "retired 2 Sep — as above",

  // Retired 3 September 2026. It offered to ask Zoho to CREATE a missing TDS
  // rate, on the belief that his master lacked one. It does not: it holds
  // twenty-odd rates, named by the nature of the payment — Professional Fees,
  // Payment of contractors HUF/Indiv, Commission or Brokerage — and none by
  // section. Nothing was missing; what was missing was a way to say which rate
  // a supplier's withholding uses. setTdsTaxForVendorsAction does that, and
  // Zoho's published API cannot create a TDS-type tax in any case.
  createTdsTaxAction: "retired 3 Sep — nothing was missing from his master; the rate is now CHOSEN, see setTdsTaxForVendorsAction",

  // decideBillAction already saves the vendor's treatment as a rule — "when
  // asked, that becomes a rule" — so this is a second way to do one thing.
  saveBillRuleAction: "redundant — decideBillAction saves the rule on the same press",

  // ---- NOT decisions. Controls the page split dropped, awaiting the founder's
  // ---- word on whether he wants them back. Listed so they are visible rather
  // ---- than forgotten a second time.
  readbackBillsAction: "LOST IN THE SPLIT — reads posted bills back out of Zoho and finishes any left as drafts; no page offers it",
  approveSelectedBillsAction: "LOST IN THE SPLIT — bulk approve on the Invoices page; single approve still works",
  skipSelectedBillsAction: "LOST IN THE SPLIT — bulk skip on the Invoices page",
  approveAllBrokerageAction: "LOST IN THE SPLIT — approve every rule-proposed brokerage line at once",
};

/** Every .ts/.tsx under app/, except the actions file itself. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (!/\.tsx?$/.test(name)) continue;
    if (p.endsWith(ACTIONS)) continue;
    out.push(p);
  }
  return out;
}

const actionsSrc = readFileSync(join(ROOT, ACTIONS), "utf8");
const exported = [...actionsSrc.matchAll(/^export async function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
check("the actions file was actually read", exported.length > 20, `found ${exported.length}`);

const haystack = sources(join(ROOT, "app")).map((p) => readFileSync(p, "utf8")).join("\n");

const orphans = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(haystack));
const unexpected = orphans.filter((n) => !(n in DELIBERATE));
const listedButUsed = Object.keys(DELIBERATE).filter((n) => !orphans.includes(n));

check("no server action is unreachable without a recorded reason",
  unexpected.length === 0,
  unexpected.length
    ? `no page renders: ${unexpected.join(", ")} — wire it up, or add it to DELIBERATE with the reason`
    : "");

check("the deliberate list has no stale entries",
  listedButUsed.length === 0,
  listedButUsed.length ? `now rendered somewhere, so remove from DELIBERATE: ${listedButUsed.join(", ")}` : "");

// The one that started this. It must stay reachable.
check("the vault CAN be read for bills from a page",
  /\bscanBillsAction\b/.test(haystack),
  "an invoice filed in the vault has to be turnable into a bill by somebody pressing something");

console.log(fails === 0
  ? `ok — no orphan actions (${exported.length} checked, ${orphans.length} deliberate)`
  : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
