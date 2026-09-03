// MATCHING A BILL TO A TDS RATE IN ZOHO.
//
// Split out of lib/zohoTds.ts and deliberately IMPORT-FREE, so it can be run
// by tests/tdsSectionAndPartyCurrency.test.ts. The rest of that file talks to
// Zoho and to Supabase; this half is arithmetic on strings and is where the
// CMG & COMPANY bill went wrong, so it is the half worth pinning.

export type TdsTax = { tax_id: string; tax_name: string; tax_percentage: number };

export type RawTax = TdsTax & {
  tax_type?: string; tax_specific_type?: string; status?: string; is_active?: boolean;
  // Zoho validates a rate's WINDOW, not just a status flag, and says so in as
  // many words when it refuses: "either expired or is applicable for a future
  // date". Reading only status/is_active is how an expired rate got attached.
  start_date?: string; end_date?: string; is_inactive?: boolean;
};

/** The numbers in a section label, in order: "393(2) Sl.17" → ["393","2","17"]. */
const sectionDigits = (v: string) => String(v ?? "").match(/\d+/g) ?? [];

/**
 * Which of Zoho's TDS rates this bill should carry.
 *
 * CMG & COMPANY, 3 September 2026, is what this is written against. Its bill
 * was right in every other way — professional fees, section 393(2) Sl.17,
 * ₹7,500 on ₹75,000 — and Zoho threw it out:
 *
 *   "The tax Dividend associated on the transaction is either expired or is
 *    applicable for a future date"
 *
 * DIVIDEND. The posting path was not using this function at all. It had its
 * own line, an `||`, that took the section OR THE RATE — so when the section
 * name did not match verbatim it attached the first rate at 10%, which in his
 * master is dividend withholding under 194, and expired besides. Zoho caught
 * it. Nothing of ours would have.
 *
 * That is a wrong challan and a wrong 26AS entry, not a near miss, so:
 *
 *   · A SECTION GIVEN IS A SECTION REQUIRED. Where the proposal names a
 *     section and no live rate answers to it, this returns null and the bill
 *     says the withholding must be applied by hand. Nothing at the same
 *     percentage is a substitute for it — 10% is 194 dividend, 194J
 *     professional fees and 393(1) alike.
 *
 *   · MATCHED ON THE SECTION'S NUMBERS, NOT ITS PUNCTUATION. Zoho writes
 *     "393(2) - Sl.No.17" where the desk holds "393(2) Sl.17"; the digits are
 *     the stable half, the spacing is not.
 *
 *   · NEVER OUTSIDE THE RATE'S OWN WINDOW. Checked against the BILL's date,
 *     which is the date Zoho judges it on — not today.
 *
 *   · THE RATE ALONE ONLY WHERE NO SECTION WAS NAMED, and even then only if
 *     exactly one live rate carries it. Two candidates is a question.
 */
export function matchTds(
  taxes: TdsTax[],
  section: string,
  rate: number,
  onISO?: string,
  chosenTaxId?: string | null,
): TdsTax | null {
  const on = /^\d{4}-\d{2}-\d{2}$/.test(String(onISO ?? "")) ? String(onISO) : null;
  const within = (t: RawTax) => {
    const from = String(t.start_date ?? "").slice(0, 10);
    const till = String(t.end_date ?? "").slice(0, 10);
    if (!on) return true;
    if (from && from > on) return false;   // not in force yet on the bill's date
    if (till && till < on) return false;   // already lapsed by it
    return true;
  };
  const pool = (taxes as RawTax[]).filter(
    (t) => !/expired/i.test(String(t.status ?? "")) && t.is_active !== false && t.is_inactive !== true && within(t));

  // A CHOICE HE MADE HIMSELF BEATS ANY MATCHING.
  //
  // Zoho's master is named by the NATURE of the payment and the desk's rules
  // are named by SECTION, and neither can be derived from the other. His own
  // books hold no "393(2) Sl.17" at all; what CMG & COMPANY needs is the rate
  // Zoho calls "Professional Fees 10%", and what FIRST FLY EXPRESS needs — for
  // the SAME section string at a different rate — is "Payment of contractors
  // HUF/Indiv 1%". No rule of thumb spans that. So the rate is picked once from
  // Zoho's real list and kept on the supplier's rule.
  //
  // Still checked for life: a rate chosen in March and expired by August must
  // not be attached in August just because it was once chosen.
  const want = String(chosenTaxId ?? "").trim();
  if (want) return pool.find((t) => String(t.tax_id) === want) ?? null;

  const digits = sectionDigits(section);
  if (digits.length) {
    const hit = pool.find((t) => {
      const got = sectionDigits(`${t.tax_name} ${t.tax_type ?? ""} ${t.tax_specific_type ?? ""}`);
      // Every number of the section, in order, somewhere in the name.
      let i = 0;
      for (const g of got) if (g === digits[i]) i++;
      return i === digits.length;
    });
    // A named section is never swapped for another. Where Zoho holds no rate
    // answering to it — which is the ordinary case, since it names by nature —
    // this returns null and the desk asks for the choice above.
    return hit ?? null;
  }

  const byRate = pool.filter((t) => Number(t.tax_percentage) === Number(rate));
  return byRate.length === 1 ? byRate[0] : null;
}

/**
 * The live rates at a given percentage — what to offer when nothing matched.
 *
 * The whole master is twenty-odd rates and most are the wrong nature; the ones
 * at the bill's own percentage are the short list worth showing.
 */
export function tdsChoicesAt(taxes: TdsTax[], rate: number, onISO?: string): TdsTax[] {
  const on = /^\d{4}-\d{2}-\d{2}$/.test(String(onISO ?? "")) ? String(onISO) : null;
  return (taxes as RawTax[]).filter((t) => {
    if (/expired/i.test(String(t.status ?? "")) || t.is_active === false || t.is_inactive === true) return false;
    if (on) {
      const from = String(t.start_date ?? "").slice(0, 10);
      const till = String(t.end_date ?? "").slice(0, 10);
      if (from && from > on) return false;
      if (till && till < on) return false;
    }
    return Number(t.tax_percentage) === Number(rate);
  });
}
