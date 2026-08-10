import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Printable shipping labels for the warehouse team: A4, three labels per
// page, big readable text. The team prints the PDF, sticks the labels on the
// parcels and enters each courier tracking ID back on /admin/warehouse.

export type LabelItem = {
  orderNo: string;      // "#10001"
  name: string;
  address: string;
  phone: string;
  contents: string;     // "FR Gold books set" / "Book A × 2, Book B × 1"
  // Filled in when the parcel has already been handed over; otherwise a ruled
  // line is printed so the packer can write it on by hand at the counter,
  // which is how a docket book is actually used.
  docket?: string | null;
  courier?: string | null;
};

/**
 * WHERE A PARCEL COMES BACK TO.
 *
 * Every courier needs a return address, and a label without one is a parcel
 * that is destroyed rather than returned when the student has moved, or the
 * address was wrong, or nobody was home three times.
 *
 * Kept here as one named constant rather than scattered through the drawing
 * code, so changing it is one edit and cannot be done by halves.
 */
export const RETURN_TO = {
  intro: "If not delivered, kindly return to this address:",
  address: "RP, 47 Pitampura, Maurya Enclave, Delhi - 110034",
  phone: "9999200355",
};

const A4 = { w: 595.28, h: 841.89 };
const PER_PAGE = 3;

export async function buildShippingLabelsPdf(items: LabelItem[], fromLine: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const wrap = (text: string, size: number, maxWidth: number): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= maxWidth) cur = t;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  for (let i = 0; i < items.length; i += PER_PAGE) {
    const page = doc.addPage([A4.w, A4.h]);
    const slot = (A4.h - 40) / PER_PAGE;
    items.slice(i, i + PER_PAGE).forEach((it, j) => {
      const top = A4.h - 20 - j * slot;
      const left = 30;
      const right = A4.w - 30;
      // Label border
      page.drawRectangle({
        x: left, y: top - slot + 10, width: right - left, height: slot - 20,
        borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1.2,
      });
      let y = top - 34;
      page.drawText(`Order ${it.orderNo}`, { x: left + 16, y, size: 16, font: bold });
      page.drawText("FREE SHIPPING", { x: right - 130, y, size: 11, font: bold, color: rgb(0.05, 0.5, 0.35) });
      y -= 26;
      page.drawText("DELIVER TO:", { x: left + 16, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 18;
      page.drawText(it.name || "Customer", { x: left + 16, y, size: 14, font: bold });
      y -= 18;
      for (const line of wrap(it.address, 12, right - left - 32).slice(0, 4)) {
        page.drawText(line, { x: left + 16, y, size: 12, font });
        y -= 15;
      }
      page.drawText(`Phone: ${it.phone || "-"}`, { x: left + 16, y, size: 12, font: bold });
      y -= 18;
      for (const line of wrap(`Contents: ${it.contents}`, 10, right - left - 32).slice(0, 2)) {
        page.drawText(line, { x: left + 16, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 12;
      }

      // ── Docket and courier ─────────────────────────────────────────────
      // Printed when we already know them; otherwise a ruled line, because a
      // docket book is filled in by hand at the counter and a label with no
      // room to write the number is a label that gets a sticker slapped over
      // it. A tracking number is also useless without the courier's name —
      // DEL122019183 means nothing until you know where to type it.
      y -= 6;
      const halfway = left + (right - left) / 2;
      const fieldLabel = (text: string, value: string | null | undefined, x: number, width: number) => {
        page.drawText(text, { x, y, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
        const at = x + font.widthOfTextAtSize(text, 10) + 4;
        if (value) {
          page.drawText(value, { x: at, y, size: 11, font: bold });
        } else {
          // A line to write on, not an empty gap nobody notices.
          page.drawLine({
            start: { x: at, y: y - 2 }, end: { x: x + width, y: y - 2 },
            thickness: 0.7, color: rgb(0.55, 0.55, 0.55),
          });
        }
      };
      fieldLabel("Docket No.:", it.docket, left + 16, halfway - left - 26);
      fieldLabel("Courier:", it.courier, halfway, right - halfway - 16);
      y -= 18;

      // ── Where it comes back to ─────────────────────────────────────────
      page.drawLine({
        start: { x: left + 16, y: y + 4 }, end: { x: right - 16, y: y + 4 },
        thickness: 0.6, color: rgb(0.75, 0.75, 0.75),
      });
      y -= 8;
      page.drawText(RETURN_TO.intro, { x: left + 16, y, size: 9, font: bold, color: rgb(0.25, 0.25, 0.25) });
      y -= 12;
      page.drawText(RETURN_TO.address, { x: left + 16, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
      y -= 11;
      page.drawText(`Contact Number: ${RETURN_TO.phone}`, { x: left + 16, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
      y -= 12;
      page.drawText(`From: ${fromLine}`, { x: left + 16, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    });
  }

  return doc.save();
}
