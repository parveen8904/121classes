// AN INVOICE FILED IN THE VAULT MUST REACH THE INVOICES PAGE.
//
// The accounts desk, 3 September 2026, with a Bansal Business Corporation
// invoice filed and showing an INVOICE badge in the vault:
//
//   "but after this, there is no option to send for approval, so that's why
//    not we are unable to post in zoho"
//
// Two separate faults behind it.
//
// FIRST, TWO VOCABULARIES. scanVaultForBills asked for
// doc_type = "Invoice / bill" — the exact string the OLD upload form on the
// Invoices page writes. The vault's two-step flow, built on 2 September,
// records the answer as kind = "invoice" and sets doc_type from the free-text
// "if something else, what?" box. The two never met, so from 2 September every
// invoice filed through the vault was invisible to the scanner: an INVOICE
// badge, no bill, nothing to approve. Three were stranded when they reported it.
//
// SECOND, NOTHING RAN. Filing said "raise the bill from the Invoices page" —
// but no button on that page raises a bill from one document; the Invoices
// page scans when IT uploads something. The desk was sent looking for a
// control that does not exist.
//
//   node --experimental-strip-types tests/vaultInvoiceToBill.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
const bills = read("lib/providerBills.ts");
const actions = read("app/admin/zoho/actions.ts");

const scan = bills.slice(bills.indexOf("export async function scanVaultForBills"));
const scanBody = scan.slice(0, scan.indexOf("export async function saveBillRule"));

/* ── the scanner sees both ways of saying "this is an invoice" ───────────── */

check("the scanner picks up the vault's own answer, kind = invoice",
  /\.eq\("kind", "invoice"\)/.test(scanBody),
  "the vault records kind; without this, everything filed through it is invisible here");

check("…and still picks up the old doc_type the Invoices page writes",
  /\.eq\("doc_type", "Invoice \/ bill"\)/.test(scanBody),
  "thirty-one documents already carry that string; dropping it would strand them instead");

check("a document matching both is read once, not twice",
  /seenDoc/.test(scanBody) && /new Set<string>\(\)/.test(scanBody));

check("they are still read oldest first",
  /localeCompare/.test(scanBody),
  "an invoice series read out of order allocates its numbers out of order");

/* ── filing an invoice raises the bill on the same press ─────────────────── */

const classify = actions.slice(actions.indexOf("export async function vaultClassifyAction"));
const classifyBody = classify.slice(0, classify.indexOf("export async function addVaultDoc"));

check("filing as an invoice runs the scan there and then",
  /kind === "invoice"[\s\S]{0,600}scanVaultForBills\(/.test(classifyBody),
  "the Invoices page's own upload has always scanned on the same press; both doors should behave alike");

check("…and lands on the Invoices page, where the bill now is",
  /redirect\(`\/admin\/zoho\/invoices\?scan=/.test(classifyBody));

// Comments are stripped first: this file quotes the old wording in order to
// explain it, and a test that cannot tell a quotation from the thing itself
// would fail on its own explanation.
const withoutComments = actions.replace(/^\s*\/\/.*$/gm, "");
check("nobody is told any more to press a control that does not exist",
  !/raise the bill from the Invoices page/.test(withoutComments),
  "there is no such button; the page scans only when it uploads");

check("a scan that fails says so and names what to press instead",
  /catch[\s\S]{0,200}Read the vault for bills/.test(classifyBody),
  "a failure here must not read as 'filed and done'");

/* ── one invoice, one bill, however many times the PDF is uploaded ───────── */

// provider_bills.vault_doc_id is unique, so one DOCUMENT raises one bill. The
// desk uploaded the same PDF twice — the screenshot shows it — and two
// documents would have raised two bills for one supplier invoice.
check("a second copy of the same supplier invoice does not raise a second bill",
  /\.eq\("bill_no", billNo\)/.test(scanBody) && /instKey\(String\(b\.institution\)\) === instKey\(institution\)/.test(scanBody),
  "approve both and the cost is booked twice and the input credit claimed twice");

check("…matched on the normalised supplier name, not the exact string",
  /instKey\(institution\)/.test(scanBody),
  "\"FIRST FLY EXPRESS\" and \"First Fly Express\" are both in the table for invoice 480/2026");

check("a bill deliberately skipped does not block its own re-upload",
  /\.not\("status", "in", "\(skipped,rejected\)"\)/.test(scanBody),
  "FIRST FLY 480/2026 sat skipped waiting to be uploaded again — blocking on it would refuse the re-upload");

check("the guard only fires on an invoice number actually read",
  /const billNo = str\(facts\.invoice_no\);\s*\n\s*if \(billNo\) \{/.test(scanBody),
  "a blank number would otherwise gather every unreadable invoice from one vendor into a single 'duplicate'");

check("the duplicate document is marked and says which bill it duplicates",
  /is_processed: true[\s\S]{0,200}Duplicate of/.test(scanBody),
  "a row that silently disappears is worse than one that says why it stopped");

check("a duplicate is counted apart from invoices waiting for a treatment",
  /dupes\+\+/.test(scanBody) && /second copy of an invoice already on the list/.test(scanBody),
  "calling it 'waiting' sends somebody hunting the Invoices page for a bill that was never meant to appear");

console.log(fails === 0 ? "ok — vault invoice reaches the bill" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
