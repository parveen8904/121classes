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
  "chutiya", "chutiye", "madarchod", "behenchod", "bhenchod", "bsdk", "gandu", "lund", "randi", "harami", "kamina", "kutta", "saala", "saale",
  // "bc" and "mc" were here and are GONE. This is an accounting group: BC is
  // Borrowing Cost. On 21 Aug 2026 two genuine Ind AS 40 questions -- "as per
  // Ind AS 40 we dont recognise the BC in IP, so how is this option correct?"
  // -- were deleted from the Financial Reporting group and filed as "abusive
  // language". A two-letter abbreviation cannot carry that weight in a room
  // where students discuss Ind AS 23 every day; anyone actually swearing is
  // caught by the spelled-out words above.
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

// SPAM WRITTEN IN CYRILLIC.
//
// On 21 Aug 2026 an account posted six pornography adverts into the Advanced
// Accounting group. Four were caught. Two were not, and the difference was
// spelling: "Lеаkеd 0NLYFАNS расk — full unсеns0rеd" uses Cyrillic е, А, с, р
// and а, which look identical on screen and match nothing a filter is looking
// for. Those two are still sitting in the group.
//
// A word list can never win that race — the same advert is rewritten endlessly
// until something gets through, which is exactly why Telegram's own anti-spam
// is the right tool for spam. But normalising the lookalikes costs one pass
// and closes the cheapest evasion, and it protects the violence guard too:
// "I will kіll you" with a Cyrillic і would otherwise sail past.
const LOOKALIKES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "ѕ": "s",
  "і": "i", "ј": "j", "ԁ": "d", "ց": "g", "һ": "h", "ӏ": "l", "ո": "n", "ν": "v",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P",
  "С": "C", "Т": "T", "У": "Y", "Х": "X", "Ѕ": "S", "І": "I", "Ј": "J",
  "0": "o", "1": "l", "3": "e", "4": "a", "$": "s", "@": "a", "!": "i",
};

/**
 * Fold lookalike characters to plain Latin so an obfuscated word still matches.
 *
 * Digits are folded ONLY inside a word that already contains letters — that is
 * leetspeak ("unсеns0rеd" → "uncensored"), whereas a bare number is a number.
 * Without that rule this is an accounting group: "Ind AS 40" became "Ind AS ao"
 * and "100000" became "looooo", which is a false positive waiting to happen.
 */
export function normaliseLookalikes(text: string): string {
  const LETTERS = /\p{L}/u;
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/(\s+)/)
    .map((token) => {
      const foldDigits = LETTERS.test(token);
      return token
        .split("")
        .map((ch) => {
          const mapped = LOOKALIKES[ch];
          if (mapped === undefined) return ch;
          if (!foldDigits && /[0-9]/.test(ch)) return ch;
          return mapped;
        })
        .join("");
    })
    .join("");
}

export function moderateMessage(text: string, extraTerms: string[] = []): ModerationResult {
  const t = (text || "").trim();
  const reasons: string[] = [];
  if (!t) return { flagged: false, reasons };
  if (EMAIL.test(t)) reasons.push("email address");
  if (URL.test(t)) reasons.push("external link");
  if (PHONE.test(t)) reasons.push("phone number");
  // Checked against the text as written AND with lookalike characters folded
  // to Latin, so Cyrillic-disguised spam is caught by the same word lists.
  const folded = normaliseLookalikes(t);
  if (PROMO.test(t) || PROMO.test(folded)) reasons.push("advertisement / spam");
  if (hasWord(t, ABUSE_WORDS) || hasWord(folded, ABUSE_WORDS)) reasons.push("abusive language");
  if (hasWord(t, ADULT_WORDS) || hasWord(folded, ADULT_WORDS)) reasons.push("adult content");
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

// ── AI VISION: is this image explicit? ──────────────────────────────────────
//
// The text moderator cannot see a picture. A student posted pornography in a
// subject group as a photo with no caption, so nothing flagged it. This runs
// the image through Claude's vision on a fast model and answers one question:
// is it pornographic / sexually explicit / nudity / graphic gore. Zero
// tolerance in a students' group — a true answer gets the message deleted and
// the poster removed.
export async function imageIsExplicit(b64: string, mediaType: string): Promise<{ explicit: boolean; reason: string }> {
  const { getSecret } = await import("@/lib/secrets");
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return { explicit: false, reason: "no-ai" };
  const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const mt = allowed.includes(mediaType) ? mediaType : "image/jpeg";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mt, data: b64 } },
            { type: "text", text: "You are a safety filter for a students' study group on Chartered Accountancy. Does this image contain pornography, sexual content, nudity, or graphic gore/violence? A normal photo of notes, a question paper, a screenshot, a person clothed, or study material is NOT explicit. Answer ONLY compact JSON: {\"explicit\":true or false,\"reason\":\"a few words\"}." },
          ],
        }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return { explicit: false, reason: `http-${res.status}` };
    const data = await res.json();
    const txt = (data?.content?.[0]?.text ?? "") as string;
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return { explicit: false, reason: "unparsed" };
    const j = JSON.parse(m[0]);
    return { explicit: j.explicit === true, reason: String(j.reason || "").slice(0, 120) };
  } catch {
    return { explicit: false, reason: "error" };
  }
}

// A link of any kind — students may share notes and images, but NOT links
// (a common route for scams and spam in a study group). Catches http(s)://,
// www., t.me/ and bare domains with a common TLD. Deliberately does not trip on
// "B.Com" / "M.Com" (needs 2+ characters before the dot) or a bare "file.pdf".
const LINK_RE = /(https?:\/\/\S+|www\.\S+|t\.me\/\S+|\b[a-z0-9][a-z0-9-]{1,}\.(?:com|in|net|org|io|co|me|edu|gov|app|xyz|info|biz|link|ly|shop|store|online|site|club|live|tel|fun)\b(?:\/\S*)?)/i;
// THREATS OF PHYSICAL VIOLENCE — ZERO TOLERANCE.
//
// His instruction, 26 Aug 2026: "if someone posting abusive messages that
// should be blocked, any kind of abuse related to physical violence, you have
// to control that group."
//
// The blocked-terms list was built for slurs, spam and adult content. It has
// nothing for somebody saying they will beat, stab or throw acid at another
// student, and that is the one thing in a group of teenagers that cannot be
// left to a moderator noticing it the next morning. A threat here is treated
// like an explicit image: the message goes, the sender goes, and the founder
// is told.
//
// TWO THINGS IT MUST NOT DO, and both are tested:
//
//   · It must not catch the victim. "He said he will kill me" is a REPORT.
//     A reporting frame — he/she/they/somebody plus said, told, threatened —
//     means the violence is being described, not delivered.
//
//   · It must not catch a student being a student. "This question is killing
//     me" and "I will kill this paper" are how they talk. So a threat has to
//     be aimed at a PERSON, not just contain a violent word.
export function threatOfViolence(text: string): { threat: boolean; reason: string } {
  const t = normaliseLookalikes(String(text ?? "")).toLowerCase().replace(/\s+/g, " ");
  if (!t.trim()) return { threat: false, reason: "" };

  // Someone describing what was done or threatened to them.
  const reportFrame =
    /\b(he|she|they|someone|somebody|this guy|that guy)\b[^.!?]{0,40}\b(said|says|saying|told|sent|threat\w*|wants?|is|was|keeps)\b/.test(t)
    || /\bthreat\w*\b[^.!?]{0,20}\b(me|us|her|him)\b/.test(t)
    || /\b(reported?|report|complain\w*)\b/.test(t);

  // Words that are a threat whatever else is in the sentence.
  const severe =
    /\b(rape|raping|molest\w*|acid|tezaab|gangrape)\b/.test(t)
    || /\b(jaan se maar|maar dunga|maar dungi|maar dalunga|khatam kar dunga|tod dunga|dekh lunga|utha lunga|goli maar|chaku|zinda nahi)\b/.test(t);

  // Violent acts that need a person on the receiving end to count.
  const violent =
    /\b(kill|killing|murder|stab|stabbing|shoot|shooting|beat|beating|thrash|bash|lynch|strangle|choke|burn|smash|slap)\b/.test(t)
    || /\bbreak (your|ur|his|her|their) (bones?|legs?|face|jaw|head|neck)\b/.test(t);

  // Aimed at a person.
  const atAPerson =
    /\b(you|u|ur|your|tujhe|tumhe|tumko|aapko|usko|isko|him|her|them|bastard|sale|saale)\b/.test(t);

  if (reportFrame) return { threat: false, reason: "" };
  if (severe) return { threat: true, reason: "threat of physical violence" };
  if (violent && atAPerson) return { threat: true, reason: "threat of physical violence" };
  return { threat: false, reason: "" };
}

// REPORTING ABUSE IS NOT ABUSE.
//
// 21 Aug 2026, CA Intermediate group. A student wrote "hi sir please remove
// this ai room pervert guy from group", "Sending inappropriate msg", "Asking
// for n₹des", "And sexting", and tagged the founder eight times. The blocked
// terms list matched the words she needed in order to describe what was being
// done to her, so NINE of her ten messages were hidden. The account she named
// had none of his hidden and was never removed. She has not posted since.
//
// His ruling: "a person who reports me abuse should not be blocked, but the
// person who is abusing should get blocked."
//
// So a flagged message is checked here first. A report asks someone for help
// about somebody else; abuse is aimed AT someone. The two are told apart by
// requiring both halves of a report — a call for help, and a third party it is
// about — and by refusing the label to anything that solicits or targets the
// reader directly.
//
// Where it is unsure, it sides with the student: a wrongly-visible report is
// seen by the founder, while a wrongly-hidden one leaves somebody being
// harassed with nowhere to turn.
export function looksLikeAbuseReport(text: string): boolean {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return false;

  // Aimed at the reader — that is the abuse itself, never a report of it.
  if (/\b(send|give|show)\s+(me|us)\b/.test(t)) return false;
  if (/\byour?\s+(pic|pics|photo|photos|number|nude|nudes|body)\b/.test(t)) return false;

  // Half one, either form: asking someone for help, OR naming the misconduct.
  // Naming it has to be enough on its own, because a report arrives in
  // fragments — "Sending inappropriate msg", "And sexting" — and every one of
  // those fragments was hidden on 21 August.
  const asking = /\b(report|reported|remove|removed|kick|ban|block|blocked|complain|complaint|action|please|plz|pls|help|sir|admin|mods?|moderator)\b/.test(t)
    || /@caparveen/.test(t);
  const namesMisconduct = /\b(harr?a?s+\w*|creep\w*|pervert\w*|stalk\w*|abusi\w*|molest\w*|misbehav\w*|inappropriate|obscene|vulgar|indecent|sexting|nudes?)\b/.test(t);

  // Half two: it is about somebody else, or about something done to me.
  const aboutSomeoneElse = /\b(he|him|his|she|her|they|them|this guy|that guy|is doing|was doing|keeps|sending|sends|sent|asking|asked|me|my|dm)\b/.test(t)
    || namesMisconduct;

  return (asking || namesMisconduct) && aboutSomeoneElse;
}

export function containsLink(text: string): boolean {
  return LINK_RE.test(text || "");
}
