/**
 * WHAT GOES IN ZOHO'S "Reference#", WHICH HOLDS FIFTY CHARACTERS AND NOT ONE MORE.
 *
 * Five expenses failed on 26-29 August 2026 with "Please ensure that the
 * Reference# has less than 50 characters". The reference was being filled with
 * the bank's whole narration whenever the statement's own ref column was empty,
 * and Axis writes things like
 *   "INB/RTGS/UTIBR62026082904412686/OM ART PRESS/PUNJAB NATIONAL BANK//////"
 * which is 71. It was capped at 90, which is Zoho's limit for a JOURNAL
 * reference, not an expense's.
 *
 * Truncating would only mangle it. The narration is not a reference in the
 * first place — it is the transaction particulars, and it already goes to Zoho
 * in the DESCRIPTION. What "reference" means here is the wire number buried
 * inside that narration, so pull that out and leave the prose where it belongs.
 *
 * Kept in its own file, free of imports, so it can be unit-tested without
 * dragging in the Supabase and Zoho clients that bankStatements.ts needs.
 */

// UPI/P2M/180603244605/…  ·  INB/NEFT/AXODH23957939129/…  ·  INB/RTGS/UTIBR6…/…
const WIRE_RE =
  /\b(?:UPI|NEFT|RTGS|IMPS|INB|MMT|ACH|TRF|CHQ|CMS)[/-]?(?:P2M|P2A|CR|DR)?[/-]([A-Z0-9]{6,32})\b/i;

/** Zoho's hard limit on an expense reference. */
export const ZOHO_REF_MAX = 50;

export function zohoReference(
  ref: string | null | undefined,
  narration: string | null | undefined,
): string {
  const own = String(ref ?? "").trim();
  if (own) return own.slice(0, ZOHO_REF_MAX);
  const wire = WIRE_RE.exec(String(narration ?? ""));
  if (wire) return wire[1].slice(0, ZOHO_REF_MAX);
  // Nothing that reads like a reference. Leaving it empty is honest; the
  // narration is on the document either way.
  return "";
}
