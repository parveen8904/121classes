// ONE ANSWER TO "WHAT NUMBER IS THIS", FOR EVERYTHING THAT DIALS OR MESSAGES.
//
// 3 September 2026. Counting WhatsApp sends turned up eight in sixty days
// addressed to country code ZERO — numbers a student had typed the Indian way,
// 09876543210, with the trunk prefix in front. Meta's API accepted the call, so
// our own log recorded them as "sent"; they cannot have arrived.
//
// The rule was written out three times, in lib/notify.ts, lib/phoneVerify.ts
// and lib/loginRescue.ts, each a one-liner saying "ten digits gain 91, anything
// longer already has a country code". All three were wrong the same way, and a
// FOURTH copy in lib/leadParse.ts already handled the leading zero properly —
// so the office had the right answer written down, in the file nobody sending
// a message ever looked at.
//
// It is written once here now. Nothing in this file imports anything, so it
// can be run by a test.
//
// WHY A LEADING ZERO IS ALWAYS SAFE TO REMOVE: no country calling code begins
// with one. A 0 at the front of a number meant for international dialling is
// either a national trunk prefix (India, the UK, most of Europe) or the "00"
// international access prefix — never part of the number itself.

/** This business is in India, so a bare ten-digit number is an Indian mobile. */
const DEFAULT_CC = "91";

/**
 * A number in the form Meta, Twilio and the like expect: digits only, country
 * code first, no plus.
 *
 * Returns "" when the input cannot be a phone number at all — which callers
 * should treat as "do not send", rather than sending somewhere arbitrary.
 */
export function toE164Digits(phone: string | null | undefined, defaultCc = DEFAULT_CC): string {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";

  // 00 91 98… → 91 98…, and 0 98… → 98…. Stripping every leading zero handles
  // both, and the doubled-up cases people actually type (0091, +0091).
  digits = digits.replace(/^0+/, "");
  if (!digits) return "";

  // Ten digits and no country code: ours.
  if (digits.length === 10) return `${defaultCc}${digits}`;

  // E.164 allows fifteen digits including the country code, and nothing real
  // is shorter than ten. Outside that it is a typo, an extension, or a landline
  // fragment — and a message sent to a guess is worse than one not sent.
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return "";
}

/**
 * The last ten digits — how a number is MATCHED against one already on file,
 * where 9876543210, 919876543210 and 09876543210 are all the same person.
 *
 * Deliberately separate from the above: matching wants to be generous, sending
 * wants to be exact.
 */
export function phoneTail(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}
