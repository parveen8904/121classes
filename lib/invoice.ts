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
  cin: string; pan: string;
};

export async function getGstSettings(): Promise<GstSettings> {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("key, value").in("key", [
    "gst_enabled", "gst_number", "gst_legal_name", "gst_address", "gst_state", "gst_rate", "gst_sac", "gst_inclusive", "invoice_prefix", "gst_cin", "gst_pan",
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
    cin: (m.get("gst_cin") ?? "").trim(),
    pan: (m.get("gst_pan") ?? "").trim(),
  };
}

// GST state codes (Indian states / UTs) → shown as "State Code:NN" on invoices.
const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", "punjab": "03", "chandigarh": "04",
  "uttarakhand": "05", "haryana": "06", "delhi": "07", "rajasthan": "08", "uttar pradesh": "09",
  "bihar": "10", "sikkim": "11", "arunachal pradesh": "12", "nagaland": "13", "manipur": "14",
  "mizoram": "15", "tripura": "16", "meghalaya": "17", "assam": "18", "west bengal": "19",
  "jharkhand": "20", "odisha": "21", "chhattisgarh": "22", "madhya pradesh": "23", "gujarat": "24",
  "daman and diu": "25", "dadra and nagar haveli": "26", "maharashtra": "27", "karnataka": "29",
  "goa": "30", "lakshadweep": "31", "kerala": "32", "tamil nadu": "33", "puducherry": "34",
  "andaman and nicobar islands": "35", "telangana": "36", "andhra pradesh": "37", "ladakh": "38",
};
export function stateCode(state: string): string {
  return STATE_CODES[state.trim().toLowerCase()] ?? "";
}

// "44600" → "Rupees Forty Four Thousand Six Hundred only." (Indian system).
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
export function amountInWords(amount: number): string {
  const n = Math.round(amount);
  if (n <= 0) return "Rupees Zero only.";
  let rest = n;
  const parts: string[] = [];
  const crore = Math.floor(rest / 10000000); rest %= 10000000;
  const lakh = Math.floor(rest / 100000); rest %= 100000;
  const thousand = Math.floor(rest / 1000); rest %= 1000;
  const hundred = Math.floor(rest / 100); rest %= 100;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return `Rupees ${parts.join(" ")} only.`;
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

const NUM = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Combined TAX INVOICE + RECEIPT on one A4 page — the founder's long-standing
// Aldine format, continued for the website: boxed header with GSTIN/CIN/PAN,
// Billed to = Shipped to (always the payer), HSN/SAC item table with CGST+SGST
// (intra-state) or IGST, amount in words, then a tear-off RECEIPT with the
// student's Registration No., payment reference and the standing terms.
export async function buildInvoicePdf(input: {
  invoiceNo: string; date: Date; s: GstSettings; gst: GstBreakup;
  buyerName: string; buyerGstin?: string | null; buyerAddress?: string | null; buyerState: string;
  itemDescription: string;
  itemHsn?: string;                 // default: settings SAC (999293 coaching)
  registrationNo?: number | string | null;
  receiptNo?: string | null;        // e.g. "#10001"
  paymentRef?: string | null;       // Razorpay order/payment reference
  paymentMode?: string;             // default "Online Payment"
  receiptDetail?: string | null;    // e.g. "Starting: 25-07-2026 · Valid till: 24-08-2026"
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const dark = rgb(0.08, 0.08, 0.08); const grey = rgb(0.35, 0.35, 0.35);
  const M = 36; const R = 559; // content box: x 36..559
  let y = 812;
  const txt = (t: string, x: number, size = 9, f: PDFFont = font, color = dark) => page.drawText(t, { x, y, size, font: f, color });
  const txtAt = (t: string, x: number, yy: number, size = 9, f: PDFFont = font, color = dark) => page.drawText(t, { x, y: yy, size, font: f, color });
  const rightTxt = (t: string, xRight: number, size = 9, f: PDFFont = font) =>
    page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y, size, font: f, color: dark });
  const hline = (yy: number, x1 = M, x2 = R, w = 0.8) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color: dark });
  const vline = (x: number, y1: number, y2: number, w = 0.8) =>
    page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: w, color: dark });
  const wrap = (t: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = t.split(/\s+/); const out: string[] = []; let cur = "";
    for (const w of words) { const c = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(c, size) <= maxW) cur = c; else { if (cur) out.push(cur); cur = w; } }
    if (cur) out.push(cur); return out;
  };
  const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

  const s = input.s;
  const hsn = input.itemHsn ?? s.sac;
  const g = input.gst;
  const intra = g.intraState;
  const halfRate = g.rate / 2;

  // ---------- HEADER ----------
  const headTop = y;
  y -= 16;
  txt(s.legalName, M + 6, 13, bold);
  txtAt(s.enabled ? "Tax Invoice" : "Bill of Supply", 265, y, 13, bold);
  txtAt("No.:", 420, y, 9, font, grey); txtAt(input.invoiceNo, 448, y, 10, bold);
  y -= 14;
  txt((s.address || "").slice(0, 60), M + 6, 9, bold);
  txtAt("Date:", 420, y, 9, font, grey); txtAt(dmy(input.date), 448, y, 10, bold);
  y -= 14;
  hline(y + 6);
  const regLine = [
    s.gstin ? `GSTIN:${s.gstin}` : "",
    s.cin ? `CIN:${s.cin}` : "",
    s.pan ? `PAN:${s.pan}` : "",
  ].filter(Boolean).join("  |  ");
  if (regLine) { txtAt(regLine, (595.28 - bold.widthOfTextAtSize(regLine, 8.5)) / 2, y - 5, 8.5, bold); y -= 16; }
  hline(y + 2);

  // ---------- BILLED TO / SHIPPED TO (same person always) ----------
  const buyerCode = stateCode(input.buyerState);
  const buyerLines = [
    ...(input.buyerAddress ? input.buyerAddress.split("\n").flatMap((l) => wrap(l.toUpperCase(), font, 8.5, 230)) : []),
    input.buyerState.toUpperCase(),
    ...(input.buyerGstin ? [`GSTIN: ${input.buyerGstin.toUpperCase()}`] : []),
    `State Code:${buyerCode || "-"}`,
  ].slice(0, 6);
  const boxTop = y;
  const boxH = 16 + buyerLines.length * 11 + 8;
  const mid = (M + R) / 2;
  for (const [x0] of [[M], [mid]] as const) {
    const label = x0 === M ? "Billed to " : "Shipped to ";
    txtAt(label, x0 + 6, boxTop - 12, 8.5, font, grey);
    txtAt((input.buyerName || "Student").toUpperCase(), x0 + 6 + font.widthOfTextAtSize(label, 8.5), boxTop - 12, 9, bold);
    let yy = boxTop - 24;
    for (const l of buyerLines) { txtAt(l, x0 + 6, yy, 8.5); yy -= 11; }
  }
  vline(mid, boxTop, boxTop - boxH);
  y = boxTop - boxH;
  hline(y);
  txtAt("Remarks:", M + 6, y - 11, 8.5); y -= 16;
  hline(y);

  // ---------- ITEMS TABLE ----------
  // Columns (x left edges); last two are the tax columns.
  const C = { sr: M, desc: M + 30, hsn: 188, qty: 230, unit: 258, rate: 286, total: 334, disc: 384, taxable: 426, t1: 476, t2: 518 };
  const colXs = [C.sr, C.desc, C.hsn, C.qty, C.unit, C.rate, C.total, C.disc, C.taxable, C.t1, C.t2, R];
  const th = (t: string[], x: number, w: number, yTop: number) => {
    let yy = yTop - 10;
    for (const l of t) { txtAt(l, x + (w - bold.widthOfTextAtSize(l, 7.5)) / 2, yy, 7.5, bold); yy -= 9; }
  };
  const headH = 30;
  th(["Sr.No."], C.sr, C.desc - C.sr, y); th(["Services", "Supplied"], C.desc, C.hsn - C.desc, y);
  th(["HSN/ SAC"], C.hsn, C.qty - C.hsn, y); th(["Qty"], C.qty, C.unit - C.qty, y); th(["Unit"], C.unit, C.rate - C.unit, y);
  th(["Rate per", "Item"], C.rate, C.total - C.rate, y); th(["Total"], C.total, C.disc - C.total, y);
  th(["Discount"], C.disc, C.taxable - C.disc, y); th(["Taxable", "Amount"], C.taxable, C.t1 - C.taxable, y);
  th([intra ? "CGST" : "IGST"], C.t1, C.t2 - C.t1, y); th([intra ? "SGST" : ""], C.t2, R - C.t2, y);
  const headBottom = y - headH;
  hline(headBottom);

  const descLines = wrap(input.itemDescription, font, 7.5, C.hsn - C.desc - 8);
  const rowH = Math.max(30, 12 + descLines.length * 9);
  let yy = headBottom - 12;
  txtAt("1", C.sr + 12, yy, 7.5);
  let dyy = yy; for (const l of descLines.slice(0, 4)) { txtAt(l, C.desc + 4, dyy, 7.5); dyy -= 9; }
  txtAt(hsn, C.hsn + 6, yy, 7.5);
  txtAt("NA", C.qty + 8, yy, 7.5); txtAt("NA", C.unit + 6, yy, 7.5);
  const num = (v: number, xr: number, b = false, size = 7) => txtAt(NUM(v), xr - (b ? bold : font).widthOfTextAtSize(NUM(v), size), yy, size, b ? bold : font);
  num(g.total, C.total - 4); num(g.total, C.disc - 4);
  const discount = Math.round((g.total - g.taxable - (g.cgst + g.sgst + g.igst)) * 100) / 100; // usually 0
  num(Math.max(0, discount), C.taxable - 4);
  num(g.taxable, C.t1 - 4, true);
  if (intra) {
    num(g.cgst, C.t2 - 3, true);
    txtAt(`@ ${halfRate}%`, C.t1 + 8, yy - 9, 6.5, font, grey);
    num(g.sgst, R - 3, true);
    txtAt(`@ ${halfRate}%`, C.t2 + 8, yy - 9, 6.5, font, grey);
  } else if (g.applied) {
    num(g.igst, C.t2 - 3, true);
    txtAt(`@ ${g.rate}%`, C.t1 + 8, yy - 9, 6.5, font, grey);
  }
  const rowBottom = headBottom - rowH;
  hline(rowBottom);

  // Total row
  yy = rowBottom - 12;
  txtAt("Total", C.rate + 8, yy, 8, bold);
  const numT = (v: number, xr: number) => txtAt(NUM(v), xr - bold.widthOfTextAtSize(NUM(v), 7), yy, 7, bold);
  numT(g.total, C.disc - 4); numT(Math.max(0, discount), C.taxable - 4);
  numT(g.taxable, C.t1 - 4);
  if (intra) { numT(g.cgst, C.t2 - 3); numT(g.sgst, R - 3); } else if (g.applied) numT(g.igst, C.t2 - 3);
  const totalBottom = rowBottom - 20;
  hline(totalBottom);
  // Table verticals
  for (const x of colXs) vline(x, y, totalBottom);

  // Amount in words + grand total
  yy = totalBottom - 14;
  txtAt(amountInWords(g.total), M + 6, yy, 9, bold);
  txtAt(NUM(g.total), R - 4 - bold.widthOfTextAtSize(NUM(g.total), 10), yy, 10, bold);
  const wordsBottom = totalBottom - 22;
  hline(wordsBottom);

  yy = wordsBottom - 14;
  txtAt(`This is a computer generated Invoice issued by ${s.legalName} and does not require signature.`, M + 6, yy, 8.5, bold); yy -= 11;
  txtAt("Declaration: This Invoice is issued for the specified services only.", M + 6, yy, 8.5, bold); yy -= 26;
  txtAt("Customer Signature", M + 6, yy, 9);
  const invBottom = yy - 8;
  hline(invBottom);
  // Outer border of the invoice
  vline(M, headTop, invBottom); vline(R, headTop, invBottom); hline(headTop);

  // ---------- tear line ----------
  yy = invBottom - 14;
  const dashes = "- ".repeat(85);
  txtAt(">8", M, yy, 9, bold, grey);
  txtAt(dashes.slice(0, 160), M + 16, yy, 8, font, grey);
  txtAt("8<", R - 12, yy, 9, bold, grey);

  // ---------- RECEIPT ----------
  yy -= 20;
  txtAt(`Receipt # ${(input.receiptNo ?? input.invoiceNo).replace(/^#/, "")}`, M, yy, 9.5, bold);
  txtAt("RECEIPT", 270, yy, 13, bold);
  txtAt(`Gen: ${dmy(input.date)}`, 480, yy, 7.5, font, grey);
  yy -= 12;
  txtAt(`Dated ${dmy(input.date)}`, M, yy, 9);
  yy -= 16;
  hline(yy + 6);

  const regNo = input.registrationNo != null && input.registrationNo !== "" ? String(input.registrationNo) : "-";
  const para =
    `Received with thanks from ${(input.buyerName || "Student").toUpperCase()} Registration No. ${regNo}, ` +
    `a sum of Rs.${NUM(g.total)} ( ${amountInWords(g.total).replace(/^Rupees /, "Rupees ").replace(/\.$/, "")} ) ` +
    `by ${input.paymentMode ?? "Online Payment"}${input.paymentRef ? ` Ref.# ${input.paymentRef}` : ""}.`;
  for (const l of wrap(para, font, 9, R - M - 8)) { txtAt(l, M + 2, yy, 9); yy -= 12; }
  yy -= 4;

  // Receipt item table — value columns are RIGHT edges; headers right-align
  // over the same edges so nothing can collide.
  const RCno = M, RCitem = M + 22;
  const REdges = [
    { x: 344, head: ["Fees"] },
    { x: 388, head: ["Previous", "Discount"] },
    { x: 432, head: ["Previous", "Net Paid"] },
    { x: 476, head: ["Current", "Discount"] },
    { x: 520, head: ["Current", "Net Paid"] },
    { x: 558, head: ["Balance", "Fees*"] },
  ];
  hline(yy + 8);
  txtAt("#", RCno + 4, yy - 2, 7.5, bold);
  txtAt("Item", RCitem + 2, yy - 2, 7.5, bold);
  for (const c of REdges) {
    let ty = yy - 2;
    for (const l of c.head) { txtAt(l, c.x - bold.widthOfTextAtSize(l, 6.8), ty, 6.8, bold); ty -= 8; }
  }
  yy -= 20; hline(yy + 6);
  txtAt("1", RCno + 4, yy - 4, 8);
  txtAt(input.itemDescription.slice(0, 58), RCitem + 2, yy - 4, 8, bold);
  const rvals = [g.total, 0, 0, 0, g.total, 0];
  rvals.forEach((v, i) => txtAt(NUM(v), REdges[i].x - font.widthOfTextAtSize(NUM(v), 7.5), yy - 4, 7.5));
  yy -= 14;
  if (input.receiptDetail) { txtAt(input.receiptDetail, RCitem + 2, yy, 7.5, font, grey); yy -= 11; }
  hline(yy + 4);
  yy -= 12;

  // Terms — the founder's standing conditions, adapted for online payments.
  txtAt("NOTE:", M + 2, yy, 7.5, bold); yy -= 9;
  const terms = [
    `1. This is only a Receipt of Payment made by you to ${s.legalName.toUpperCase()} and is valid only on payment realization.`,
    "2. Payments made by way of Online Payment Gateway [Debit/Credit Card / Net Banking / UPI] require no signature. Valid proof of transaction might be required from the depositor.",
    "3. This Receipt will be Null & Void for failed payments (due to whatsoever reason).",
    "4. Refunds only at the sole discretion of the Management, with minimum Refund Charges of Rs.2000/- per Subject plus Prorata fees for the period availed till the date of Refund Approval.",
    "5. NO Refund against this Receipt if the student has opted for Combos (and discounts thereof).",
    "6. If for whatsoever reason, any batch/subscription is cancelled by us, fees will be refunded to confirmed registered students.",
    `7. Registration & confirmation is subject to the terms & conditions of ${s.legalName.toUpperCase()}. Your registration is considered as acceptance of these terms and conditions.`,
  ];
  for (const t of terms) {
    for (const l of wrap(t, font, 6.8, R - M - 16)) { txtAt(l, M + 10, yy, 6.8); yy -= 8.5; }
  }
  yy -= 4;
  txtAt("*Balance Fees amount is indicative, subjected to timely payment and charges if applicable and Services to be rendered.", M + 2, yy, 7.5, bold); yy -= 10;
  txtAt("You can now Pay online directly at www.caparveensharma.com", M + 2, yy, 7.5, bold); yy -= 9;
  txtAt("Payment modes available: Debit Card / Credit Card / Net Banking / UPI.", M + 2, yy, 7, font, grey);

  return doc.save();
}
