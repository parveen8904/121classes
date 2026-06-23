// Lightweight, dependency-free content moderation for group chat. Flags emails,
// phone numbers, external/suspicious links, ads/spam, and abusive language.
// Tune the lists below anytime. Returns the reasons so we can log + show them.

export type ModerationResult = { flagged: boolean; reasons: string[] };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL = /(https?:\/\/|www\.)\S+|\b(?:t\.me|wa\.me|chat\.whatsapp\.com|bit\.ly|tinyurl\.com|youtu\.be|forms\.gle|linktr\.ee|rb\.gy)\/\S+/i;
// 10+ digits in a run (optionally spaced/hyphenated) = a phone number.
const PHONE = /(?:\+?\d[\s-]?){10,}/;
const PROMO =
  /\b(buy now|earn money|work from home|click here|guaranteed|limited offer|cashback|forex|crypto|bitcoin|investment plan|join my|dm me|subscribe to my channel|promo ?code|coupon code|discount code|whatsapp me|telegram me)\b/i;

// Keep modest; admins can extend. Matched as whole words (case-insensitive).
const ABUSE_WORDS = [
  "fuck", "fucking", "bitch", "bastard", "asshole", "dick", "slut", "whore",
  "motherfucker", "bullshit", "cunt", "retard", "idiot", "stupid",
  // common Hindi/Hinglish slurs
  "chutiya", "chutiye", "madarchod", "behenchod", "bhenchod", "bsdk", "mc", "bc", "gandu", "lund", "randi", "harami", "kamina", "kutta", "saala", "saale",
];

function hasAbuse(text: string): boolean {
  const low = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  return ABUSE_WORDS.some((w) => low.includes(` ${w} `));
}

function isShouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 15 && letters === letters.toUpperCase();
}

function isRepetitionSpam(text: string): boolean {
  return /(.)\1{9,}/.test(text) || /(\b\w+\b)(\s+\1\b){4,}/i.test(text);
}

export function moderateMessage(text: string): ModerationResult {
  const t = (text || "").trim();
  const reasons: string[] = [];
  if (!t) return { flagged: false, reasons };
  if (EMAIL.test(t)) reasons.push("email address");
  if (URL.test(t)) reasons.push("external link");
  if (PHONE.test(t)) reasons.push("phone number");
  if (PROMO.test(t)) reasons.push("advertisement / spam");
  if (hasAbuse(t)) reasons.push("abusive language");
  if (isShouting(t)) reasons.push("shouting");
  if (isRepetitionSpam(t)) reasons.push("spam (repetition)");
  return { flagged: reasons.length > 0, reasons };
}
