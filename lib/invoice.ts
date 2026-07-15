import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { createServiceClient } from "@/lib/supabase/service";

// GST-compliant invoicing for gift subscriptions. Rules (India):
//  · Supplier state == buyer state  → CGST + SGST (rate split in half)
//  · Supplier state != buyer state  → IGST (full rate)
// Never CGST+IGST together. If GST is off (unregistered), it's a Bill of Supply
// with no tax lines.

export type GstSettings = {
  enabled: boolean; gstin: string; legalName: string; address: string;
  state: string; rate: number; sac: string; inclusive: boolean; prefix: string;
};

export async function getGstSettings(): Promise<GstSettings> {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("key, value").in("key", [
    "gst_enabled", "gst_number", "gst_legal_name", "gst_address", "gst_state", "gst_rate", "gst_sac", "gst_inclusive", "invoice_prefix",
  ]);
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  return {
    enabled: (m.get("gst_enabled") ?? "1") === "1" && !!(m.get("gst_number") ?? "").trim(),
    gstin: (m.get("gst_number") ?? "").trim(),
    legalName: m.get("gst_legal_name") ?? "CA Parveen Sharma",
    address: m.get("gst_address") ?? "",
    state: (m.get("gst_state") ?? "Delhi").trim(),
    rate: Number(m.get("gst_rate")) || 18,
    sac: (m.get("gst_sac") ?? "999293").trim(),
    inclusive: (m.get("gst_inclusive") ?? "1") === "1",
    prefix: m.get("invoice_prefix") ?? "CAPS/",
  };
}

// Indian financial year label for the amount's date, e.g. "2026-27".
function fyLabel(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0=Jan
  const startYear = m >= 3 ? y : y - 1; // FY starts in April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export type GstBreakup = {
  taxable: number; cgst: number; sgst: number; igst: number; total: number; rate: number; intraState: boolean; applied: boolean;
};

// Split a GST-inclusive (or exclusive) total into taxable value + tax lines
// based on whether the buyer is in the supplier's state.
export function computeGst(total: number, buyerState: string, s: GstSettings): GstBreakup {
  if (!s.enabled || s.rate <= 0) {
    return { taxable: total, cgst: 0, sgst: 0, igst: 0, total, rate: 0, intraState: false, applied: false };
  }
  const taxable = s.inclusive ? Math.round((total / (1 + s.rate / 100)) * 100) / 100 : total;
  const gst = s.inclusive ? Math.round((total - taxable) * 100) / 100 : Math.round((total * s.rate / 100) * 100) / 100;
  const grandTotal = s.inclusive ? total : Math.round((total + gst) * 100) / 100;
  const intraState = buyerState.trim().toLowerCase() === s.state.trim().toLowerCase();
  if (intraState) {
    const half = Math.round((gst / 2) * 100) / 100;
    return { taxable, cgst: half, sgst: gst - half, igst: 0, total: grandTotal, rate: s.rate, intraState: true, applied: true };
  }
  return { taxable, cgst: 0, sgst: 0, igst: gst, total: grandTotal, rate: s.rate, intraState: false, applied: true };
}

// Reserve the next sequential invoice number, e.g. "CAPS/2026-27/0001".
export async function nextInvoiceNo(prefix: string, when: Date): Promise<string> {
  const svc = createServiceClient();
  const { data } = await svc.rpc("next_invoice_number");
  const n = Number(data) || 1;
  return `${prefix}${fyLabel(when)}/${String(n).padStart(4, "0")}`;
}

const INR = (n: number) => "Rs. " + (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Render a clean, GST-compliant A4 invoice PDF.
export async function buildInvoicePdf(input: {
  invoiceNo: string; date: Date; s: GstSettings; gst: GstBreakup;
  buyerName: string; buyerGstin?: string | null; buyerAddress?: string | null; buyerState: string;
  itemDescription: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const teal = rgb(0.05, 0.58, 0.53); const dark = rgb(0.1, 0.1, 0.1); const grey = rgb(0.4, 0.4, 0.4);
  const M = 44; let y = 800;
  const txt = (t: string, x: number, size = 10, f: PDFFont = font, color = dark) => page.drawText(t, { x, y, size, font: f, color });
  const line = () => { page.drawLine({ start: { x: M, y: y }, end: { x: 551, y: y }, thickness: 0.7, color: rgb(0.85, 0.85, 0.85) }); };

  txt(input.s.enabled ? "TAX INVOICE" : "BILL OF SUPPLY", M, 16, bold, teal); y -= 22;
  txt(input.s.legalName, M, 12, bold); y -= 14;
  for (const l of (input.s.address || "").split(/,\s*/).reduce<string[]>((a, w) => { const last = a[a.length - 1]; if (last && (last + ", " + w).length < 70) a[a.length - 1] = last + ", " + w; else a.push(w); return a; }, [])) { txt(l, M, 9, font, grey); y -= 12; }
  if (input.s.gstin) { txt(`GSTIN: ${input.s.gstin}   State: ${input.s.state}`, M, 9, font, grey); y -= 12; }
  y -= 4; line(); y -= 16;

  txt(`Invoice No: ${input.invoiceNo}`, M, 10, bold);
  txt(`Date: ${input.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`, 360, 10, bold); y -= 20;

  txt("Bill To:", M, 10, bold); y -= 14;
  txt(input.buyerName || "-", M, 10); y -= 12;
  if (input.buyerAddress) { for (const l of input.buyerAddress.split("\n").slice(0, 3)) { txt(l, M, 9, font, grey); y -= 12; } }
  txt(`State: ${input.buyerState}${input.buyerGstin ? `    GSTIN: ${input.buyerGstin}` : ""}`, M, 9, font, grey); y -= 14;
  txt(`Place of supply: ${input.buyerState}`, M, 9, font, grey); y -= 18;
  line(); y -= 16;

  // Item
  txt("Description", M, 10, bold); txt("SAC", 320, 10, bold); txt("Amount", 470, 10, bold); y -= 14;
  txt(input.itemDescription.slice(0, 48), M, 10); if (input.s.enabled) txt(input.s.sac, 320, 10); txt(INR(input.gst.taxable), 470, 10); y -= 18;
  line(); y -= 16;

  const right = (label: string, val: string, b = false) => { txt(label, 320, 10, b ? bold : font); txt(val, 470, 10, b ? bold : font); y -= 15; };
  right("Taxable value", INR(input.gst.taxable));
  if (input.gst.applied) {
    if (input.gst.intraState) {
      right(`CGST @ ${input.gst.rate / 2}%`, INR(input.gst.cgst));
      right(`SGST @ ${input.gst.rate / 2}%`, INR(input.gst.sgst));
    } else {
      right(`IGST @ ${input.gst.rate}%`, INR(input.gst.igst));
    }
  }
  y -= 2; line(); y -= 16;
  right("TOTAL", INR(input.gst.total), true);
  y -= 24;
  txt("This is a computer-generated invoice. Thank you for your purchase.", M, 8, font, grey);
  return doc.save();
}
