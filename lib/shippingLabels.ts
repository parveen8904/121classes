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
      y -= 20;
      for (const line of wrap(`Contents: ${it.contents}`, 10, right - left - 32).slice(0, 2)) {
        page.drawText(line, { x: left + 16, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 13;
      }
      y -= 4;
      page.drawText(`From: ${fromLine}`, { x: left + 16, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
    });
  }

  return doc.save();
}
