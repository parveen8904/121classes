// Lightweight, dependency-free content moderation for group chat. Flags emails,
// phone numbers, external/suspicious links, ads/spam, abusive language, adult
// content, and admin-defined blocked terms (competitor names etc.).
// Tune the lists below anytime. Returns the reasons so we can log + show them.
//
// NOTE: discord-worker/index.js carries a copy of these rules for the Discord
// side — keep the two in sync when editing.

import { createServiceClient } from "@/lib/supabase/service";

export type ModerationResult = { flagged: boolean; reasons: string[] };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL = /(https?:\/\/|www\.)\S+|\b(?:t\.me|wa\.me|chat\.whatsapp\.com|bit\.ly|tinyurl\.com|youtu\.be|forms\.gle|linktr\.ee|rb\.gy)\/\S+/i;
// 10+ digits in a run (optionally spaced/hyphenated) = a phone number.
const PHONE = /(?:\+?\d[\s-]?){10,}/;
const PROMO =
  /\b(buy now|earn money|work from home|click here|guaranteed|limited offer|cashback|forex|crypto|bitcoin|investment plan|join my|dm me|subscribe to my channel|promo ?code|coupon code|discount code|whatsapp me|telegram me|pen ?drive classes|google drive classes|selling notes|selling classes|half price|resell)\b/i;

// Keep modest; admins can extend via the blocked-terms box (Admin → Group
// moderation). Matched as whole words (case-insensitive).
const ABUSE_WORDS = [
  "fuck", "fucking", "bitch", "bastard", "asshole", "dick", "slut", "whore",
  "motherfucker", "bullshit", "cunt", "retard", "idiot", "stupid",
  // common Hindi/Hinglish slurs
  "chutiya", "chutiye", "madarchod", "behenchod", "bhenchod", "bsdk", "mc", "bc", "gandu", "lund", "randi", "harami", "kamina", "kutta", "saala", "saale",
  "gaand", "jhant", "bhosdike", "bhosdi", "lauda", "laude", "tatti", "chodu", "raand",
];

// Adult / sexual content — never appropriate in a study group.
const ADULT_WORDS = [
  "porn", "porno", "pornhub", "xvideos", "xnxx", "onlyfans", "nude", "nudes",
  "naked", "sexy", "sexting", "boobs", "hentai", "xxx", "blowjob",
  "horny", "erotic", "stripper", "escort", "callgirl", "call girl",
  "nangi", "chudai", "chudayi", "sambhog",
];

function hasWord(text: string, words: string[]): boolean {
  const low = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  return words.some((w) => low.includes(` ${w} `));
}

function isShouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 15 && letters === letters.toUpperCase();
}

function isRepetitionSpam(text: string): boolean {
  return /(.)\1{9,}/.test(text) || /(\b\w+\b)(\s+\1\b){4,}/i.test(text);
}

export function moderateMessage(text: string, extraTerms: string[] = []): ModerationResult {
  const t = (text || "").trim();
  const reasons: string[] = [];
  if (!t) return { flagged: false, reasons };
  if (EMAIL.test(t)) reasons.push("email address");
  if (URL.test(t)) reasons.push("external link");
  if (PHONE.test(t)) reasons.push("phone number");
  if (PROMO.test(t)) reasons.push("advertisement / spam");
  if (hasWord(t, ABUSE_WORDS)) reasons.push("abusive language");
  if (hasWord(t, ADULT_WORDS)) reasons.push("adult content");
  if (isShouting(t)) reasons.push("shouting");
  if (isRepetitionSpam(t)) reasons.push("spam (repetition)");
  // Admin-defined terms (competitor names, banned phrases) — substring match so
  // multi-word brand names work; case-insensitive.
  if (extraTerms.length) {
    const low = t.toLowerCase();
    const hit = extraTerms.find((term) => term && low.includes(term.toLowerCase()));
    if (hit) reasons.push(`blocked term (“${hit}”)`);
  }
  return { flagged: reasons.length > 0, reasons };
}

// ---- Admin-editable blocked terms (site_settings.moderation_blocked_terms,
// one per line). Cached ~60s so group traffic doesn't hammer the DB. ----
let _terms: { at: number; list: string[] } | null = null;
export async function getBlockedTerms(): Promise<string[]> {
  const now = Date.now();
  if (_terms && now - _terms.at < 60_000) return _terms.list;
  try {
    const { data } = await createServiceClient()
      .from("site_settings")
      .select("value")
      .eq("key", "moderation_blocked_terms")
      .maybeSingle();
    const list = String(data?.value ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length >= 2);
    _terms = { at: now, list };
    return list;
  } catch {
    return _terms?.list ?? [];
  }
}

// Convenience: moderation including the admin's dynamic blocked terms.
export async function moderateMessageDyn(text: string): Promise<ModerationResult> {
  return moderateMessage(text, await getBlockedTerms());
}
