import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// The Sponsor Guide content — single source of truth, rendered to both the web
// page (/sponsor-guide) and the PDF (attached to coupon emails). Edit here.
export const SPONSOR_GUIDE = {
  title: "Sponsor a Student",
  tagline: "Give the gift of education with CA Parveen Sharma",
  intro:
    "Thank you for choosing to sponsor a CA aspirant. When you sponsor a student, you pay for their access and we set everything up for them instantly — they simply log in and start learning. This short guide explains what they receive and exactly how to sponsor.",
  sections: [
    {
      heading: "What the student gets",
      bullets: [
        "Complete video classes taught by CA Parveen Sharma himself.",
        "24x7 AI doubt-solving trained on his classes & ICAI material — instant answers.",
        "A personal day-by-day study plan, right up to their exam.",
        "MCQ & descriptive tests with performance reports (rank, weak areas, what to revise).",
        "Revision videos, handwritten & typed notes, amendments kept up to date.",
        "RTP, MTP & past exam papers with suggested answers — and AI evaluation of their own answers.",
        "Case-study scenarios with MCQs and instant explanations.",
        "Web, Windows & Mac apps, with secure offline downloads.",
      ],
    },
    {
      heading: "Who you can sponsor",
      bullets: [
        "A deserving student who can't afford coaching.",
        "A family member, friend, or your articled/employee.",
        "Anyone preparing for CA Intermediate or CA Final.",
      ],
    },
    {
      heading: "How to sponsor — step by step",
      steps: [
        "Go to caparveensharma.com and create your free account (just your email).",
        "On the welcome screen, click “Sponsoring for someone? Click here.”",
        "Enter your mobile number.",
        "Choose the subject, the plan (Silver or Gold) and the duration.",
        "Fill the student’s details — name, email (their login) and exam attempt.",
        "Enter your billing details (add your GSTIN if you want input credit) and apply your coupon code if you have one.",
        "Pay securely. That’s it!",
        "The student is enrolled instantly and emailed a link to set their password. Your payment receipt and GST invoice come to you.",
      ],
    },
    {
      heading: "What you (the sponsor) get",
      bullets: [
        "A GST-compliant invoice and payment receipt, emailed to you.",
        "A sponsor dashboard showing the students you’ve sponsored and their activity.",
        "Complete privacy for the student — they never see the amount you paid.",
      ],
    },
  ],
  couponNote:
    "If you received a coupon code, enter it at the checkout step to get your discount automatically.",
  contact: "Questions? Email contact@caparveensharma.com or visit caparveensharma.com.",
};

export async function buildSponsorGuidePdf(): Promise<Uint8Array> {
  const g = SPONSOR_GUIDE;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.05, 0.58, 0.53), dark = rgb(0.12, 0.12, 0.12), grey = rgb(0.4, 0.4, 0.4);
  const A4 = { w: 595.28, h: 841.89 }, M = 48, maxW = A4.w - M * 2;
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; };
  const ensure = (n: number) => { if (y - n < M) newPage(); };
  const wrap = (t: string, f: PDFFont, size: number, w = maxW) => {
    const words = t.split(/\s+/); const lines: string[] = []; let line = "";
    for (const wd of words) { const test = line ? line + " " + wd : wd; if (f.widthOfTextAtSize(test, size) > w && line) { lines.push(line); line = wd; } else line = test; }
    if (line) lines.push(line); return lines;
  };
  const draw = (t: string, f: PDFFont, size: number, color = dark, indent = 0) => {
    for (const ln of wrap(t, f, size, maxW - indent)) { ensure(size + 5); page.drawText(ln, { x: M + indent, y: y - size, size, font: f, color }); y -= size + 5; }
  };

  // Header band
  page.drawRectangle({ x: 0, y: A4.h - 96, width: A4.w, height: 96, color: teal });
  page.drawText(g.title, { x: M, y: A4.h - 52, size: 26, font: bold, color: rgb(1, 1, 1) });
  page.drawText(g.tagline, { x: M, y: A4.h - 74, size: 12, font, color: rgb(0.92, 1, 0.98) });
  y = A4.h - 120;
  draw(g.intro, font, 11, grey); y -= 10;

  for (const sec of g.sections) {
    ensure(30); y -= 6;
    page.drawText(sec.heading, { x: M, y: y - 15, size: 14, font: bold, color: teal }); y -= 24;
    if ("bullets" in sec && sec.bullets) {
      for (const b of sec.bullets) { ensure(16); page.drawText("•", { x: M, y: y - 11, size: 11, font: bold, color: teal }); draw(b, font, 10.5, dark, 16); y -= 3; }
    }
    if ("steps" in sec && sec.steps) {
      sec.steps.forEach((st, i) => { ensure(18); page.drawText(String(i + 1) + ".", { x: M, y: y - 11, size: 11, font: bold, color: teal }); draw(st, font, 10.5, dark, 20); y -= 4; });
    }
    y -= 6;
  }
  ensure(40);
  page.drawRectangle({ x: M, y: y - 34, width: maxW, height: 30, color: rgb(0.93, 0.98, 0.96) });
  page.drawText("🎟  " + g.couponNote, { x: M + 10, y: y - 22, size: 10, font: bold, color: teal }); y -= 46;
  draw(g.contact, font, 9.5, grey);
  return doc.save();
}
