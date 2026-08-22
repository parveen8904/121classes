// WHY A STUDENT WAS TOLD "AT LEAST 8 CHARACTERS" ABOUT A TWELVE-CHARACTER
// PASSWORD, FOR EVER.
//
// This project's Supabase policy requires a lower-case letter, a capital, a
// digit and a symbol. When one is missing, Supabase answers:
//
//   "Password should contain at least one character of each: abcdefghij…,
//    ABCDEFGHIJ…, 0123456789, !@#$%^&*()…"
//
// The sign-up form turned every error containing the word "char" into "Use at
// least 8 characters." So a student typing `mypassword` was told to make it
// longer. They made it longer. It failed again, with the same message. There is
// no length at which `mypassword` starts working, and nothing on the screen
// ever said why — which is what reached us on WhatsApp as "new application
// launched having little glitch".
//
// So the rule is stated in one place, checked before we ask the server, and
// reported one missing piece at a time in words a person can act on.

export const PASSWORD_MIN = 6;

/** What is actually required, for showing on the form before they type.
 * The founder's rule (22 Aug): keep it simple — 6 characters with a capital, a
 * number and a special character. We do NOT judge whether a password is "common"
 * or "strong"; if it meets these four things, it is accepted. */
export const PASSWORD_RULE =
  "At least 6 characters, with one CAPITAL letter, one number and one special character (like ! or @).";

/**
 * What is missing from this password, or null when it will be accepted.
 *
 * One thing at a time and in a fixed order: a list of four faults is a wall of
 * text, and the person only has to fix one to make progress.
 */
export function passwordProblem(pw: string): string | null {
  const p = pw ?? "";
  if (p.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters — yours has ${p.length}.`;
  if (p.length > 72) return "That is too long — please keep it under 72 characters.";
  // No lowercase requirement — the founder's rule is capital + number + special.
  if (!/[A-Z]/.test(p)) return "Add a CAPITAL letter (A–Z).";
  if (!/[0-9]/.test(p)) return "Add a number (0–9).";
  if (!/[^A-Za-z0-9]/.test(p)) return "Add a symbol, such as ! @ # or $.";
  return null;
}

/**
 * Turn whatever the server said into something a person can act on.
 *
 * The order matters: "one character of each" is about VARIETY and contains the
 * word "character", so it must be recognised before any test for length — that
 * single mistake is what produced the loop.
 */
export function friendlyPasswordError(raw: string): string {
  const m = (raw ?? "").toLowerCase();

  if (m.includes("aal2")) return "__MFA__";

  // Variety, not length. Checked FIRST, for the reason above.
  if (m.includes("one character of each") || m.includes("lowercase") || m.includes("uppercase") ||
      (m.includes("should contain") && m.includes("digits"))) {
    return `Your password needs a bit more variety. ${PASSWORD_RULE}`;
  }

  if (m.includes("pwned") || m.includes("compromis") || m.includes("breach") || m.includes("leaked")) {
    return "That password has appeared in a known data breach, so it is not safe to use. " +
      "Please choose a different one you have not used on another website — it can be simple, just not a common one.";
  }

  if (m.includes("weak") || m.includes("strength")) {
    return `That password is not strong enough. ${PASSWORD_RULE}`;
  }

  if (m.includes("at least") || m.includes("length") || m.includes("short")) {
    return `Use at least ${PASSWORD_MIN} characters.`;
  }

  if (m.includes("same") || m.includes("different from")) {
    return "Please choose a different password from your current one.";
  }

  return raw;
}
