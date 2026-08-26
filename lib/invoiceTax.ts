import { createServiceClient } from "@/lib/supabase/service";
import { extractPdfText } from "@/lib/pdf";
import { parseInvoiceTaxText } from "@/lib/ai";

// READING THE TAX OFF THE SUPPLIER'S INVOICE.
//
// His standing rule, and the reason this file is careful: "You have to read the
// invoice completely for the purpose of taxation. How much is the CGST and IGST
// and SGST, because you cannot derive it on your own? You have to check it from
// the invoice." And again on 26 Aug 2026: "No reverse engineering. Just see the
// invoice and fill it."
//
// So this TRANSCRIBES. It is not allowed to compute a taxable value from a
// total and a rate, or to split a tax amount into halves because the supplier
// looks local. Where a figure is not printed, it comes back null and a person
// deals with it.
//
// And what it reads is a PROPOSAL. It lands in provider_bills.tax_read, beside
// the real columns rather than in them, because the founder's gate is the only
// thing that turns a reading into the figures an entry posts from.

export type InvoiceTax = {
  taxable_value: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total: number | null;
  invoice_no: string | null;
  invoice_date: string | null;
  note: string | null;
  /** The supplier as the invoice names them — see the note on InvoiceTaxRead. */
  vendor_name: string | null;
  vendor_gstin: string | null;
  vendor_state: string | null;
  vendor_address: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  read_at: string;
};

/**
 * Read one bill's filed invoice. Returns null when there is no readable paper —
 * the caller says so rather than inventing figures.
 */
export async function readInvoiceTax(billId: string): Promise<InvoiceTax | null> {
  const svc = createServiceClient();
  const { data: bill } = await svc
    .from("provider_bills").select("id, vault_doc_id").eq("id", billId).maybeSingle();
  if (!bill?.vault_doc_id) return null;

  const { data: doc } = await svc
    .from("zoho_vault_docs").select("file_url").eq("id", bill.vault_doc_id).maybeSingle();
  if (!doc?.file_url) return null;

  const text = await extractPdfText(String(doc.file_url));
  // A scanned invoice with no text layer is a real case, and the honest answer
  // is that it could not be read — not an empty set of figures that would look
  // like "this invoice charges no tax".
  if (!text || text.trim().length < 40) return null;

  const j = await parseInvoiceTaxText(text) as unknown as Record<string, unknown> | null;
  if (!j) return null;

  const n = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(String(v).replace(/[₹,\s]/g, ""));
    return Number.isFinite(x) ? x : null;
  };
  const s = (v: unknown): string | null => {
    const t = String(v ?? "").trim();
    return t && t !== "null" ? t : null;
  };

  return {
    taxable_value: n(j.taxable_value),
    cgst: n(j.cgst),
    sgst: n(j.sgst),
    igst: n(j.igst),
    total: n(j.total),
    invoice_no: s(j.invoice_no),
    invoice_date: s(j.invoice_date),
    note: s(j.note),
    vendor_name: s(j.vendor_name),
    // A GSTIN is 15 characters; anything else is not one, and a half-read one
    // would create a vendor Zoho cannot file a return against.
    vendor_gstin: (() => {
      const g = (s(j.vendor_gstin) ?? "").toUpperCase().replace(/\s/g, "");
      return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(g) ? g : null;
    })(),
    vendor_state: s(j.vendor_state),
    vendor_address: s(j.vendor_address),
    vendor_phone: s(j.vendor_phone),
    vendor_email: s(j.vendor_email),
    read_at: new Date().toISOString(),
  };
}

/**
 * A sanity line for the screen — NOT a gate.
 *
 * Says whether the parts add up to the total the invoice prints. It never
 * changes a figure: an invoice that does not foot is a real thing (rounding
 * lines, a discount, a reverse-charge note) and the founder decides, not this.
 */
export function footingNote(t: InvoiceTax): string | null {
  const parts = [t.taxable_value, t.cgst, t.sgst, t.igst].filter((x): x is number => x !== null);
  if (t.taxable_value === null || t.total === null || parts.length < 2) return null;
  const sum = parts.reduce((a, b) => a + b, 0);
  const diff = Math.round((sum - t.total) * 100) / 100;
  if (Math.abs(diff) < 0.5) return null;
  return `The parts add to ₹${sum.toFixed(2)} against a printed total of ₹${t.total.toFixed(2)} — a difference of ₹${Math.abs(diff).toFixed(2)}. Check before using them.`;
}

/** Read the invoice and file the reading against the bill. */
export async function readAndStore(billId: string): Promise<{ ok: boolean; why: string; tax?: InvoiceTax }> {
  const tax = await readInvoiceTax(billId);
  if (!tax) {
    return { ok: false, why: "No readable invoice is filed against this bill — the vault has no PDF for it, or the PDF is a scan with no text in it." };
  }
  await createServiceClient()
    .from("provider_bills")
    .update({ tax_read: tax as unknown as Record<string, unknown>, updated_at: new Date().toISOString() })
    .eq("id", billId);

  const found = [
    tax.taxable_value !== null ? `taxable ₹${tax.taxable_value}` : null,
    tax.cgst !== null ? `CGST ₹${tax.cgst}` : null,
    tax.sgst !== null ? `SGST ₹${tax.sgst}` : null,
    tax.igst !== null ? `IGST ₹${tax.igst}` : null,
  ].filter(Boolean);

  const who = [tax.vendor_name, tax.vendor_gstin, tax.vendor_state].filter(Boolean).join(" · ");
  return {
    ok: true,
    tax,
    why: (who ? `Supplier: ${who}. ` : "") + (found.length
      ? `Read from the invoice: ${found.join(", ")}. Check them against the paper, then Save.`
      : "The invoice was read but no tax figures are printed on it. Nothing has been filled in."),
  };
}
