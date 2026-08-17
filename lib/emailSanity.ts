// IS THIS ADDRESS EVEN CAPABLE OF RECEIVING MAIL?
//
// Not "is it a real mailbox" — nothing can know that without sending. Only the
// mistakes that are certainly mistakes: a domain with no dot, a top-level domain
// that does not exist, and the handful of misspellings of the four mail
// providers that between them cover almost every student here.
//
// Why it earns its place: eight students registered with addresses like
// "@gmail" (no .com), "@gmailcom" (no dot), "@gmai.com", "@gmial.com" and
// "@gmail.con". Each became permanently unreachable — no password link, no
// checked copy, no notice — and each link we sent bounced. Bounces arrive
// nowhere, so nobody notices until a provider threatens to stop carrying your
// mail, which is how Supabase found it for us.
//
// DELIBERATELY CONSERVATIVE. A rejected address is a student turned away at
// registration, which is far worse than a bounce. So this only fires on things
// that cannot possibly be right, and it always says what to check rather than
// just refusing.

/** The misspellings actually seen, plus the obvious neighbours on a keyboard. */
const TYPOS: Record<string, string> = {
  "gmai.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmali.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmailcom": "gmail.com",
  "gmail.in": "gmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "rediffmai.com": "rediffmail.com",
  "redifmail.com": "rediffmail.com",
};

/**
 * Returns a sentence to show the student, or null if the address is plausible.
 * The sentence names the likely correction, because "invalid email" tells
 * somebody who has typed their own address a hundred times absolutely nothing.
 */
export function whyAddressLooksWrong(raw: string): string | null {
  const email = (raw ?? "").trim().toLowerCase();

  const at = email.indexOf("@");
  if (at < 1 || email.indexOf("@", at + 1) !== -1) {
    return "That does not look like an email address — it should have exactly one @ in it, like yourname@gmail.com.";
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || /\s/.test(email)) {
    return "Please check that address — it has a space in it, or nothing before the @.";
  }

  const suggestion = TYPOS[domain];
  if (suggestion) {
    return `Did you mean ${local}@${suggestion}? The address you typed ends in “@${domain}”, which does not exist, so nothing we send would ever reach you.`;
  }

  if (!domain.includes(".")) {
    return `“@${domain}” is missing its ending — did you mean ${local}@${domain}.com? Without it, nothing we send can reach you.`;
  }
  // A real TLD is at least two letters and never a digit.
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!/^[a-z]{2,}$/.test(tld)) {
    return `“@${domain}” does not look complete. Please check the part after the last dot.`;
  }
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return `“@${domain}” has a dot in the wrong place. Please check it.`;
  }

  return null;
}
