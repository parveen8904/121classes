// Shared lead-row parsing. Column order doesn't matter: the email is found by
// pattern, the phone by digits, the name is the first remaining text field.

// A cell must be a complete, valid email to be accepted as one.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
// …but inside a longer cell we still look for an address.
const EMAIL_FIND = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

// A phone must end up as exactly 10 digits. A leading +91 / 91 / 0 is a
// prefix, not part of the number, so it's stripped first. Anything else
// (9 digits, 11 digits, letters mixed in) is not a phone → ignored.
export function toPhone(raw: string): string | null {
  const cell = raw.trim();
  // Reject cells that aren't phone-shaped (digits with the usual separators).
  if (!/^[+\d][\d\s()+\-.]*$/.test(cell)) return null;
  let digits = cell.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

export type LeadRow = { name: string | null; phone: string | null; email: string | null };

// One CSV/pasted line → {name, phone, email}. Column order doesn't matter.
// A badly formatted phone or email is simply ignored; if NEITHER is valid the
// whole row is skipped (returns null).
export function parseLine(line: string): LeadRow | null {
  const cells = line
    .split(/,|;|\t/)
    .map((c) => c.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  if (!cells.length) return null;
  let email: string | null = null, phone: string | null = null;
  const rest: string[] = [];
  for (const c of cells) {
    if (!email) {
      const m = c.match(EMAIL_FIND);
      if (m && isEmail(m[0])) { email = m[0].toLowerCase(); continue; }
    }
    const p: string | null = !phone ? toPhone(c) : null;
    if (p) { phone = p; continue; }
    rest.push(c);
  }
  if (!phone && !email) return null; // nothing usable on this line
  const name = rest.find((c) => /[a-z]/i.test(c) && c.length >= 2) ?? null;
  return { name, phone, email };
}
