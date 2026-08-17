import { readFile } from "node:fs/promises";
import path from "node:path";

// SAVE OUR NUMBER, ONCE, AND THE NAME SHOWS FOR EVER.
//
// A message from 98100 79162 arrives on a student's phone as a bare number. The
// name only appears if they tap through — and WhatsApp will not put the name in
// front of the number without Meta's green tick, which is Meta's to grant.
//
// But a number the student has SAVED shows its name everywhere: WhatsApp, the
// call screen, notifications, the SMS list. So instead of waiting on Meta, ask
// once. One tap on this and their phone offers to add "CA Parveen Sharma Classes"
// with the logo attached, and the anonymity problem is gone for that student on
// every channel at once.
//
// The photograph is embedded in the card rather than linked, so it survives
// being saved offline and needs no request to our server afterwards.
//
// NOTE ON WHICH NUMBERS GO ON IT. Only the two public ones: 98100 79162 (the
// WhatsApp business line) and 98100 12674 (sales and technical help). The
// founder's personal number is deliberately absent and must stay that way.

export const dynamic = "force-static";
export const revalidate = 86400;

function fold(line: string): string {
  // vCard lines over 75 octets must be folded, continuation lines beginning with
  // a single space. Phones are forgiving about this; Outlook and some Android
  // importers are not.
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  if (rest) parts.push(" " + rest);
  return parts.join("\r\n");
}

export async function GET() {
  let photo = "";
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", "icon-512.png"));
    photo = bytes.toString("base64");
  } catch {
    /* a card without a picture is still worth saving */
  }

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:;CA Parveen Sharma Classes;;;",
    "FN:CA Parveen Sharma Classes",
    "ORG:CA Parveen Sharma Classes",
    "TITLE:CA Final & CA Inter coaching",
    "TEL;TYPE=WORK,VOICE:+919810079162",
    "TEL;TYPE=WORK,VOICE:+919810012674",
    "EMAIL;TYPE=WORK:contact@caparveensharma.com",
    "URL:https://caparveensharma.com",
    "NOTE:Financial Reporting (CA Final) and Advanced Accounting (CA Inter). Classes\\, study planner\\, tests and doubt solving at caparveensharma.com",
    photo ? fold(`PHOTO;ENCODING=b;TYPE=PNG:${photo}`) : "",
    "END:VCARD",
  ].filter(Boolean);

  // CRLF endings: the spec requires them and several Android importers reject a
  // card that uses bare newlines.
  const vcf = lines.join("\r\n") + "\r\n";

  return new Response(vcf, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'attachment; filename="CA-Parveen-Sharma-Classes.vcf"',
      "Cache-Control": "public, max-age=86400",
    },
  });
}
