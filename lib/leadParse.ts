// Shared lead-row parsing. Column order doesn't matter: the email is found by
// pattern, the phone by digits, the name is the first remaining text field.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Normalise anything that looks like an Indian mobile to its 10 digits.
export function toPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 && /^[6-9]/.test(ten) ? ten : null;
}

export type LeadRow = { name: string | null; phone: string | null; email: string | null };

export function parseLine(line: string): LeadRow | null {
  const cells = line
    .split(/,|;|\t/)
    .map((c) => c.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  if (!cells.length) return null;
  let email: string | null = null, phone: string | null = null;
  const rest: string[] = [];
  for (const c of cells) {
    if (!email && EMAIL_RE.test(c)) { email = c.match(EMAIL_RE)![0].toLowerCase(); continue; }
    const p: string | null = !phone ? toPhone(c) : null;
    if (p) { phone = p; continue; }
    rest.push(c);
  }
  if (!phone && !email) return null; // nothing contactable on this line
  const name = rest.find((c) => /[a-z]/i.test(c) && c.length >= 2) ?? null;
  return { name, phone, email };
}
