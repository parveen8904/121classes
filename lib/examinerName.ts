// WHO CHECKED THE COPY, SAID BY NAME.
//
// His instruction, 25 Aug 2026: a copy checked by CA Piyush must say "Checked
// by CA Piyush", one he checked himself must say "Checked by CA Parveen
// Sharma", and the student must be told too — not just the examiner screen.
//
// The name was already being captured on every claim (descriptive_attempts
// .examiner_name); it simply never reached the student, who saw an anonymous
// "checked by examiner". A named check is worth more to a student than an
// anonymous one, and it is also the person they would ask about a mark.
//
// THE PREFIX IS ADDED ONCE, HERE. Profiles hold "Parveen Sharma" and
// "Piyush" — the "CA" is a courtesy title this system knows applies to its
// faculty, and typing it into the profile instead would put it in a dozen
// other places it does not belong (a login greeting, an email salutation).
// Where a name already carries the title it is not doubled.

/** "Piyush" → "CA Piyush"; "CA Piyush" → "CA Piyush"; blank → null. */
export function examinerTitle(raw: string | null | undefined): string | null {
  const n = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!n) return null;
  // A placeholder is not a name. "Examiner" was the fallback stored before
  // this existed, and "Checked by CA Examiner" would be worse than nothing.
  if (/^(examiner|admin)$/i.test(n)) return null;
  return /^(ca|cs|cma|dr|prof|mr|mrs|ms)\b/i.test(n) ? n : `CA ${n}`;
}

/** The full line a student reads: "Checked by CA Piyush" — or the honest
 *  fallback when we genuinely do not know who checked it. */
export function checkedByLine(raw: string | null | undefined): string {
  const t = examinerTitle(raw);
  return t ? `Checked by ${t}` : "Checked by the examiner";
}
