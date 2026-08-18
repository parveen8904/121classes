// Claude (Anthropic) integration — SERVER-ONLY. Degrades gracefully: when
// ANTHROPIC_API_KEY is absent, AI calls return null and the app falls back to
// "our faculty will review this".

import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { BRIEF_RULES } from "@/lib/marketingBrief";

export async function aiConfigured(): Promise<boolean> {
  return Boolean(await getSecret("ANTHROPIC_API_KEY"));
}

// ----- Per-feature on/off switches (admin cost control) -----
// The admin can disable individual AI services from Admin → AI usage & cost.
// Disabled feature keys are stored as a JSON array in
// site_settings.ai_disabled_features. A disabled feature's AI call returns null,
// so the app falls back gracefully (e.g. "faculty will review"). Default: all on.
export const AI_TOGGLES: { key: string; label: string; desc: string }[] = [
  { key: "doubt", label: "Answer student doubts", desc: "AI replies to doubts on class pages & Telegram (otherwise sent to faculty)." },
  { key: "group_doubt", label: "Answer doubts in Telegram/Discord groups", desc: "AI replies (marked 🤖) only when a student TAGS the bot or replies to it — it never interrupts student discussions. Mirrored across platforms. Daily cap applies." },
  { key: "ask_me", label: "“Ask me” assistant", desc: "The website / portal help box." },
  { key: "grade", label: "Evaluate typed descriptive answers", desc: "AI marks typed subjective answers (otherwise faculty reviews them)." },
  { key: "grade_descriptive", label: "Evaluate handwritten paper (PDF)", desc: "AI reads a student's uploaded handwritten answer PDF and grades it against your solution PDF." },
  { key: "generate_mcq", label: "Generate MCQ tests", desc: "Create MCQs from a transcript / the AI repository." },
  { key: "import_mcq_pdf", label: "Read uploaded MCQ PDFs", desc: "Digitise your own MCQ test PDFs into the engine." },
  { key: "generate_subjective", label: "Generate descriptive tests", desc: "Create long-form questions from a transcript." },
  { key: "suggested_answer", label: "Suggested model answers", desc: "Draft a full-marks model answer." },
  { key: "summarize", label: "Class summaries", desc: "Summarise a class from its transcript." },
  { key: "transcribe", label: "Handwritten notes → typed", desc: "Convert a handwritten-notes PDF into typed notes." },
  { key: "recommend", label: "Study recommendations", desc: "Personalised topic recommendations." },
  { key: "interview", label: "AI mock interview", desc: "Career-corner interview practice." },
  { key: "cv", label: "CV summary polish", desc: "Improve a CV summary / objective." },
  { key: "marketing", label: "Marketing pack generator & weekly autopilot", desc: "Writes multi-channel campaign packs (Telegram/WhatsApp + Instagram + YouTube) and powers the Monday autopilot on the Campaigns page." },
  { key: "articles", label: "SEO articles writer", desc: "Writes original public study articles from the topic queue (Admin → Articles). Original content only — never copied from the web." },
];

let _aiDisabled: { at: number; set: Set<string> } | null = null;
async function aiDisabledSet(): Promise<Set<string>> {
  const now = Date.now();
  if (_aiDisabled && now - _aiDisabled.at < 30000) return _aiDisabled.set;
  try {
    const { data } = await createServiceClient()
      .from("site_settings")
      .select("value")
      .eq("key", "ai_disabled_features")
      .maybeSingle();
    const arr = JSON.parse((data?.value as string) || "[]");
    const set = new Set<string>(Array.isArray(arr) ? arr.map(String) : []);
    _aiDisabled = { at: now, set };
    return set;
  } catch {
    return _aiDisabled?.set ?? new Set<string>();
  }
}

// True when AI is configured AND this feature isn't switched off by the admin.
export async function aiFeatureEnabled(feature: string): Promise<boolean> {
  if (!(await aiConfigured())) return false;
  return !(await aiDisabledSet()).has(feature);
}

// Cheaper model for high-frequency student calls (doubts / ask-me). Override
// via the ANTHROPIC_MODEL_FAST secret. Defaults to Haiku (~3x cheaper).
async function fastModel(): Promise<string> {
  return (await getSecret("ANTHROPIC_MODEL_FAST")) || "claude-haiku-4-5";
}

// The model for anything a STUDENT reads. Doubt answers were running on the
// small fast model to save pennies, and the founder noticed the difference in
// quality — rightly. Teaching answers now get the proper model; the fast one
// stays for bulk, mechanical work (relevance sorting, CV tips, interview
// practice) where volume matters more than depth.
async function teachingModel(): Promise<string> {
  return (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
}

// Per-1M-token prices (USD) by model family, for the admin cost readout.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus": { in: 5, out: 25 },
  "claude-sonnet": { in: 3, out: 15 },
  "claude-haiku": { in: 1, out: 5 },
};
function priceFor(model: string): { in: number; out: number } {
  const key = Object.keys(PRICES).find((p) => model.startsWith(p));
  return key ? PRICES[key] : PRICES["claude-sonnet"];
}

// WHAT A CACHED PROMPT COSTS.
//
// Anthropic bills three different rates against the input price: fresh tokens
// at 1x, tokens WRITTEN into the cache at 1.25x, and tokens READ back out at
// 0.1x. It also reports them separately — a cache read is NOT included in
// input_tokens — so charging only for input_tokens would quietly understate the
// bill on a write and overstate the saving on a read. The monthly spend alert
// runs off this figure, so it has to be right.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

async function logUsage(
  feature: string, model: string, inTok: number, outTok: number,
  cacheRead = 0, cacheWrite = 0,
) {
  try {
    const p = priceFor(model);
    const cost =
      (inTok / 1e6) * p.in +
      (cacheWrite / 1e6) * p.in * CACHE_WRITE_MULTIPLIER +
      (cacheRead / 1e6) * p.in * CACHE_READ_MULTIPLIER +
      (outTok / 1e6) * p.out;
    const svc = createServiceClient();
    await svc.from("ai_usage").insert({
      feature, model, input_tokens: inTok, output_tokens: outTok,
      cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite,
      cost_usd: Number(cost.toFixed(5)),
    });
    await maybeSpendAlert(svc);
  } catch {
    // never let usage logging break an AI call
  }
}

// Warn once when the month's AI spend passes the cap.
//
// This used to keep its own running total in site_settings, incremented on
// every call: read the old value, add this cost, write it back. Two AI calls
// running at once — and mock-paper drafting, digests and doubts overlap
// constantly — both read the same figure and the second write erased the
// first. A classic lost update. It had drifted $3.90 low on $48.57, about 8%,
// and because the counter was the LOW one it was the alert that arrived late.
//
// There is no counter now. The figure comes from ai_spend_since(), which adds
// the actual rows up in the database and cannot disagree with itself. A flag
// per month remembers that the warning has already gone.
let lastCapCheck = 0;

async function maybeSpendAlert(svc: ReturnType<typeof createServiceClient>) {
  const get = async (k: string) => (await svc.from("site_settings").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;

  // Aggregating on every single AI call would be wasteful, and a budget
  // warning five minutes late is no worse than one on the instant.
  if (Date.now() - lastCapCheck < 5 * 60_000) return;
  lastCapCheck = Date.now();

  const cap = Number(await get("ai_monthly_cap_usd")) || 0;
  if (cap <= 0) return;

  const month = new Date().toISOString().slice(0, 7);
  const flagKey = `ai_alerted:${month}`;
  if (await get(flagKey)) return; // already said so this month

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data } = await svc.rpc("ai_spend_since", { period_start: monthStart });
  const total = ((data ?? []) as { cost_usd: number | string }[])
    .reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  if (total < cap) return;

  // Mark it BEFORE sending. A send that fails must not leave the flag unset
  // and mail him again on the next call, and again, and again.
  await svc.from("site_settings").upsert({ key: flagKey, value: new Date().toISOString() }, { onConflict: "key" });

  const to = (await get("ai_alert_email")) || "";
  if (to) {
    const { sendEmail } = await import("@/lib/notify");
    await sendEmail(
      to,
      "⚠️ CA Parveen Sharma — AI monthly budget reached",
      `<p>AI spend this month has reached <strong>$${total.toFixed(2)}</strong>, against your cap of $${cap.toFixed(2)}.</p>
       <p>This is a warning only — nothing has been switched off. The breakdown is in Admin → AI usage &amp; cost.</p>`,
    );
  }
}

type CallOpts = {
  model?: string;
  feature?: string;
  /**
   * Cache the system prompt, so a repeated prefix is billed at a tenth.
   *
   * Only worth setting where the system prompt is BOTH large and identical
   * call to call. Two things make it a waste otherwise: Anthropic will not
   * cache a prefix under ~1024 tokens at all (the flag is silently ignored),
   * and a cache WRITE costs 1.25x — so caching a prompt nothing reads back
   * within the five-minute window is a 25% surcharge, not a saving.
   *
   * The size guard below enforces the first of those. Judging the second is
   * the caller's job, and the numbers to judge it by are on /admin/ai-usage.
   */
  cache?: boolean;
};

// THE MINIMUM DEPENDS ON THE MODEL, AND GETTING IT WRONG COSTS NOTHING BUT
// GAINS NOTHING EITHER.
//
// Anthropic refuses to cache a prefix below a floor, and the floor is TWICE as
// high on Haiku as on Sonnet and Opus. Doubts run on both — 632 Sonnet calls
// and 159 Haiku in the last thirty days — so a single flat threshold would
// either skip caching that Sonnet could have done, or attach a cache_control
// to Haiku prompts that silently does nothing.
//
// Four characters per token is the usual rough rule for English prose; the
// margin below keeps us clear of the boundary rather than gambling on it.
function minCacheableChars(model: string): number {
  return model.includes("haiku") ? 8800 : 4400; // 2048 vs 1024 tokens
}

async function callClaude(system: string, user: string, maxTokens = 1024, opts: CallOpts = {}): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  // Admin kill-switch: a disabled feature makes no AI call at all.
  if (opts.feature && opts.feature !== "other" && (await aiDisabledSet()).has(opts.feature)) return null;
  const model = opts.model || (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  // Asked for AND big enough to actually take. A prompt below the minimum is
  // sent plainly rather than with a cache_control the API would ignore.
  const wantsCache = !!opts.cache && system.length >= minCacheableChars(model);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        // A cached system prompt must be sent as BLOCKS, not a bare string —
        // cache_control attaches to a content block and there is nowhere to
        // hang it on a plain string. Everything below the breakpoint (the user
        // message) stays uncached, which is right: it is different every time.
        system: wantsCache
          ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
          : system,
        messages: [{ role: "user", content: user }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage(
      opts.feature || "other", model,
      Number(u.input_tokens) || 0, Number(u.output_tokens) || 0,
      Number(u.cache_read_input_tokens) || 0,
      Number(u.cache_creation_input_tokens) || 0,
    );
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

// Founder's rule: doubt answers must be PLAIN language — no markdown stars,
// no #, no special characters, no emojis. Simple sentences and 1. 2. 3. lists.
const PLAIN_STYLE =
  " WRITE IN PLAIN SIMPLE LANGUAGE ONLY: no markdown, no asterisks, no bold markers, no # headings, " +
  "no special characters and NO emojis. Use plain sentences; when listing, use simple numbering like 1. 2. 3.";

const ASSISTANT_SYSTEM =
  "You are the AI study assistant for CA Parveen Sharma (CA coaching). " +
  "You help Indian CA (Foundation/Intermediate/Final) students with clear, accurate, exam-focused explanations. " +
  "ALWAYS answer in short points (never long paragraphs) and keep the WHOLE answer under 100 words. " +
  "Use Indian accounting/tax/law context, and reference relevant standards or sections where useful. " +
  "If a question is outside the CA syllabus or you are unsure, say so and suggest asking the faculty. " +
  "You assist under CA Parveen Sharma's guidance — never claim to be a human teacher." +
  PLAIN_STYLE;

export async function answerDoubt(question: string, context?: string): Promise<string | null> {
  const user = (context ? `Topic context: ${context}\n\n` : "") + `Student's doubt: ${question}`;
  return withBeta(await callClaude(ASSISTANT_SYSTEM, user, 700, { model: await teachingModel(), feature: "doubt" }));
}

// Sentinel the model returns when the repository doesn't cover the question.
export const NEED_FACULTY = "NEED_FACULTY";

// WHEN WE CANNOT ANSWER, SAY SOMETHING TRUE — never nothing.
//
// The old behaviour was one line: "Our faculty will look at it and reply here
// shortly." Then nothing followed. A promise nobody keeps is worse than "we do
// not have that", because the student waits instead of looking elsewhere.
//
// So before a question is handed to a person, one more reply goes: what we DO
// have, and which page it is on. It is allowed to say we do not have something.
// It is not allowed to invent a page — that sends a student to a wall.
const LAST_RESORT_SYSTEM =
  "You are replying on behalf of CA Parveen Sharma Classes to a student whose question could not be " +
  "answered from the study material.\n" +
  "Write a SHORT reply: 2 to 4 sentences, plain English, no headings.\n" +
  "If a list of what we hold is given below, answer from it: name the paper and give its link — " +
  "never attach or promise a file. If the same thing exists for more than one course and you cannot " +
  "tell which they are on, ask one short question instead of guessing. " +
  "If they asked where to find something, name the page from the map below. " +
  "If we do not have the thing they named, say so plainly, once, and offer the nearest thing we do have. " +
  "NEVER invent a page, a link, a price, a date or a section number. " +
  "Do not say faculty will reply shortly — a person may still write, but this reply must be useful on its own. " +
  "If it needs a person (payment, refund, access already paid for), ask them to raise it at " +
  "caparveensharma.com/support with their registered email, so it is tracked. " +
  "Never mention AI or that you could not answer." +
  PLAIN_STYLE;

/** Said when even that fails, so a reply still goes out. */
export const PLAIN_FALLBACK =
  "Thank you for writing. I could not place this one straight away — please raise it at " +
  "caparveensharma.com/support with your registered email and we will come back to you there, " +
  "so that it is not lost.";

/**
 * A truthful reply built from what the site actually has.
 * Returns null only when AI is unavailable; callers then use PLAIN_FALLBACK.
 */
export async function replyFromSiteMap(question: string): Promise<string | null> {
  const [{ siteDirectory }, { findContent }] = await Promise.all([
    import("@/lib/siteDirectory"),
    import("@/lib/contentFinder"),
  ]);
  const [map, found] = await Promise.all([
    siteDirectory().catch(() => ""),
    findContent(question).catch(() => ""),
  ]);
  const where = found ? `${found}\n\n${map}` : map;
  const out = await callClaude(
    `${LAST_RESORT_SYSTEM}\n\n${where}`,
    `STUDENT'S MESSAGE:\n${question}`,
    400,
    { model: await fastModel(), feature: "doubt" },
  );
  const text = (out ?? "").trim();
  return text.length > 15 && text !== NEED_FACULTY ? text : null;
}


// Removed at the founder's instruction (2026-08-05). It used to read "Beta
// version — AI answers can make mistakes", appended under every answer.
//
// His reasoning, and it is right: the site already says this where it belongs,
// and repeating it under each answer undercut the answer itself. A student
// reading a worked solution in his name does not want a footnote telling them
// not to trust it. It is kept as an empty string rather than deleted so no
// caller has to change.
export const BETA_NOTE = "";

// Belt-and-braces: even if the model slips, strip markdown symbols and emojis
// so the student always sees clean plain text (founder's rule).
function plainText(t: string): string {
  return t
    .replace(/\*\*|__|~~|`+/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-•▪◦]\s+/gm, "- ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Clean the answer up. There is no longer a note to append — the name at the
// bottom of the message is the whole signature the student needs.
function withBeta(text: string | null): string | null {
  if (!text || text.trim() === NEED_FACULTY) return text;
  return plainText(text);
}

const REPO_SYSTEM =
  "You are the AI study assistant for CA Parveen Sharma's CA coaching, helping Indian CA " +
  "(Intermediate/Final) students. Use the STUDY MATERIAL below (class transcripts/digests — each labelled " +
  "with its 'Class N' number — plus notes, question banks, ICAI study material, RTP/MTP, past papers) as " +
  "your ONLY source.\n" +
  "HIS CONTENT, AND NOTHING ELSE. This is CA Parveen Sharma's instruction and it is not negotiable: " +
  "answer ONLY from the material below. Never from your own general knowledge, never from the internet, " +
  "never from any other source, in any situation. A question about a numbered question, an RTP, an MTP or " +
  "the ICAI study material is answerable ONLY from what is in the material below — all of it is there.\n" +
  "WHERE HIS TREATMENT DIFFERS FROM WHAT YOU BELIEVE, HIS GOVERNS. Students here sit an Ind AS paper, and " +
  "India carries deliberate carve-outs from IFRS. Your general knowledge is fuller than any one teacher's " +
  "notes, and on a carve-out fuller is WRONG. A student asked whether a foreign currency convertible bond " +
  "fails the fixed-for-fixed test; the IFRS answer is yes and the Ind AS answer is no, and the room was " +
  "taught the wrong one under his name. Do not let that happen again.\n" +
  "IF THE MATERIAL BELOW DOES NOT COVER IT, STILL HELP — but say so. His instruction: do not push the " +
  "student back to Sir, answer as best you can. So give your best answer AND open it with one plain line: " +
  "'This is not covered in Sir\u2019s material, so this is my own understanding \u2014 please confirm it with him " +
  "before you rely on it in the exam.' Never dress general knowledge up as his teaching, and never sign it " +
  "as his. Where his material DOES cover it, follow it exactly and say nothing of the sort.\n" +
  "STYLE: simple, plain English a student under exam pressure can follow. Short sentences. Be CONCISE — " +
  "well under 120 words for a normal doubt, and never pad. But do not be so short that the student is left " +
  "guessing: if the answer turns on a condition, a date or an exception, say it. When asked to SOLVE a " +
  "specific/numbered question or a full problem, give the COMPLETE step-by-step solution (working notes, " +
  "journal entries, the relevant AS/Ind AS/section) and take whatever length that needs.\n" +
  "Teach like CA Parveen Sharma: state the rule, then show it applied, then the one mistake students make " +
  "here. Never invent a figure, a section number or a case that is not in the material.\n" +
  "ALWAYS end with one short line telling the student WHICH CLASS to watch for this — use the 'Class N' " +
  "labels in the material, e.g. 'Covered in Class 42.' If several, name them; if you truly can't tell, omit it.\n" +
  "For 'solve question 15 of Amalgamation / Q6 of ICAI / question 10 of RTP May 2026': find it in the material " +
  "and solve fully. If it is NOT in the uploaded material, say so in one line and offer to solve if they paste it.\n" +
  "ALDINE IS OURS. NEVER DISOWN IT. aldine.edu.in and Aldine Ventures are CA Parveen Sharma's own " +
  "long-standing site and company; the new portal at caparveensharma.com is the same teaching under " +
  "its own name. A student who says 'Aldine team' IS our student and has come to the right place. " +
  "Never reply 'we are not Aldine' or anything like it — to them it reads as being turned away by " +
  "the very people they paid. Greet them and answer the question.\n" +
  "A STUDENT REPORTING SOMETHING BROKEN WANTS IT MENDED, NOT FILED. Do not answer a problem you can " +
  "actually solve by asking them to raise a support ticket. The support page is for money, refunds " +
  "and access already paid for — matters that need a person and a record. Everything else: answer it.\n" +
  "THE PASSWORD RULE, because students get stuck here and the screen used to explain it badly: a " +
  "password needs at least 8 characters AND a capital letter, a small letter, a number and a symbol " +
  "such as ! or @. Something like Study@2026 works. If a student says the password screen keeps " +
  "asking for '8 characters' even though theirs is longer, that is this: they are missing a capital, " +
  "a number or a symbol. Tell them that plainly — it is fixed on the site now, but say it anyway so " +
  "they are through in the next minute rather than the next day.\n" +
  "STAY INSIDE WHAT IS TAUGHT HERE. You are CA Parveen Sharma's assistant for HIS subjects, and " +
  "there are TWO: Financial Reporting at CA Final, and Advanced Accounting at CA Intermediate. " +
  "The same accounting, taught at two levels. Financial Instruments is not a third subject — it is " +
  "a PART of Financial Reporting, sold as its own live batch, so treat a question about it as a " +
  "Financial Reporting question. That is the whole of your expertise, and you must say so rather " +
  "than reach past it.\n" +
  "NEVER state how many papers a group or course has, which papers are in which group, what the " +
  "exam pattern or marking scheme is, or how the syllabus is arranged. ICAI changes these and you " +
  "will be out of date. NEVER correct a student on any of it — if their list of papers differs from " +
  "what you believe, THEY are the one sitting the exam; say nothing about it.\n" +
  "NEVER teach, plan or advise on another subject — Audit, Law, Costing, Direct or Indirect Tax, " +
  "Advanced Financial Management, or anything else not taught here. Do not write study plans for " +
  "them, do not say how long they take, do not rank their difficulty.\n" +
  "When a student asks about the course as a whole, or about passing overall, answer only for the " +
  "subject we teach and say plainly: 'I can only help you properly with Financial Reporting — that " +
  "is what is taught here. For the other papers you will need your own faculty or the ICAI " +
  "material.' That is a complete and honest answer, not a failure.\n" +
  "WHEN A LIST OF WHAT WE HOLD IS GIVEN ABOVE, answer from it: name the paper and give its link. " +
  "Send the LINK, never a file — the papers open on their own page where the student can attempt them " +
  "and have the answer checked, and the hitlist is a page of question numbers, not a PDF.\n" +
  "IF THE SAME THING EXISTS FOR MORE THAN ONE COURSE and you cannot tell which the student is on, " +
  "ASK ONE SHORT QUESTION — 'Are you doing CA Final or CA Intermediate?' — instead of guessing or " +
  "sending both. If it is ready for one course and not the other, say exactly that.\n" +
  "BUT NEVER ASK WHAT THEY HAVE ALREADY TOLD YOU. Read the conversation above first. If they have " +
  "said their course, their subject, their attempt or their exam date anywhere in it — even in a " +
  "single word like 'CA final' or 'inter' — that is the answer, and asking again is the rudest thing " +
  "you can do. Never ask the same question twice in one conversation. If a message is a bare answer " +
  "to something you just asked, treat it as that answer and CONTINUE — do not say it was cut off, " +
  "and do not start again.\n" +
  "WHAT IS FREE, AND MUST NEVER BE REFUSED FOR WANT OF A PLAN. A student wrote in asking us to start " +
  "her study plan and was told she had to be a paying student. She did not. She already HAD a plan, and " +
  "the planner has never cost anything. Being told to pay for something you are entitled to is the " +
  "fastest way to lose somebody who was ready to buy.\n" +
  "These need only an account, and NO subscription of any kind:\n" +
  "  • the study planner — /build-your-plan to make one, /planner to see it, and /free-planner needs no " +
  "account at all;\n" +
  "  • the demo classes on every subject;\n" +
  "  • the book PDFs, for every student on the portal;\n" +
  "  • asking a doubt, and the free case-scenario and MCQ practice.\n" +
  "NEVER tell anybody they need a plan, a subscription or a payment for one of those, whatever their " +
  "account shows. A plan is needed for the full recorded classes and the paid features — say that about " +
  "THOSE and nothing else.\n" +
  "AND BEFORE SAYING SOMEBODY HAS NO ACCESS AT ALL, look at what they actually asked for. \"No active " +
  "subscription\" is an answer about classes. It is not an answer about the planner, the demo classes or " +
  "their own books.\n" +
  "IF THEY ARE ASKING WHERE SOMETHING IS — a test series, mock papers, notes, a class, the planner, " +
  "downloads, a list they have heard of — answer from the WHERE THINGS ARE map: name the page and say what " +
  "is on it. If we do not have the thing they named, say so plainly in one line and offer the nearest thing " +
  "we do have. Never invent a page: a student sent to a page that does not exist is worse off than one told " +
  "we do not have it.\n" +
  `Only reply with exactly "${NEED_FACULTY}" when a PERSON must act — a payment dispute, a refund, ` +
  "access they have paid for and cannot open, or anything about their own account that needs checking. " +
  "Not knowing an answer is not a reason: say what you do know, point them at the page, and let a person " +
  "add the rest." +
  PLAIN_STYLE;

// Answer strictly from the repository material. Returns the answer, the literal
// NEED_FACULTY sentinel (escalate to faculty), or null if AI/material unavailable.
export async function answerDoubtFromMaterial(
  question: string,
  material: string,
  feature: string = "doubt", // "group_doubt" for Telegram-group answers (own toggle + cap)
  opts: { betaNote?: boolean; history?: string } = {},
): Promise<string | null> {
  // What he has taught the AI goes ABOVE the material, because a house rule that
  // sits below the study material reads as a footnote. One hook here rather than
  // six at the call sites, so a lesson taught once applies on every channel —
  // email, Telegram, WhatsApp, Discord, the groups and the website.
  const { lessonPrefix } = await import("@/lib/aiLessons");
  const taught = await lessonPrefix(question, feature);

  // Enough room to actually SOLVE a numbered question (working notes, journal
  // entries), not just a one-line conceptual reply.
  // The map of the site travels with the study material. A great many messages
  // are not doubts but "where is it?" — and answering those from material that
  // does not mention pages meant declining them all.
  const [{ siteDirectory }, { findContent }] = await Promise.all([
    import("@/lib/siteDirectory"),
    import("@/lib/contentFinder"),
  ]);
  // The map says which pages exist; the finder says which of OUR papers and
  // lists answer this particular message, with the link to each. It costs one
  // small query and only runs when the question names something we stock.
  const [where, found] = await Promise.all([siteDirectory(), findContent(question)]);
  // The thread goes FIRST. What the student told us a minute ago outranks
  // anything the study material can say about who they are.
  const history = (opts.history ?? "").trim();

  // WHAT NEVER CHANGES GOES ABOVE THE LINE, SO IT IS BILLED ONCE.
  //
  // This is the single biggest AI cost in the system — 791 calls and 4.2M input
  // tokens in thirty days — and two thirds of those calls land within five
  // minutes of another one, because students ask in clusters. That makes it the
  // one place prompt caching genuinely pays.
  //
  // The rule is that a cached prefix must be IDENTICAL and must come FIRST, so
  // the two stable pieces move into the system prompt: the house rules, and the
  // map of the site (which changes only when a subject is added, and is already
  // held in memory between calls). Everything that differs per student — the
  // lessons chosen for this question, the thread so far, the papers this
  // message matched, the material and the question itself — stays below in the
  // user message, where it is billed normally.
  //
  // The map used to sit in the middle of the user message, and moving it up is
  // what makes the prefix cacheable at all: a single varying character anywhere
  // above the breakpoint invalidates the whole thing.
  const system = `${REPO_SYSTEM}\n\n${where}`;
  const user =
    `${taught}${history ? `${history}\n\n` : ""}` +
    (found ? `${found}\n\n` : "") +
    `STUDY MATERIAL:\n${material || "(none provided)"}\n\nSTUDENT QUESTION:\n${question}`;
  const raw = await callClaude(system, user, 2000, { model: await teachingModel(), feature, cache: true });
  // A reply CA Parveen Sharma reads and sends himself carries no machine
  // disclaimer — it is his answer by the time the student sees it.
  if (opts.betaNote === false) return raw && raw.trim() !== NEED_FACULTY ? plainText(raw) : raw;
  return withBeta(raw);
}

// Answer a doubt where the student ATTACHED an image or PDF (a photographed
// question, a screenshot, a problem PDF). Claude reads the attachment AND the
// typed text together, grounded in the same study material.
export async function answerDoubtWithAttachment(
  question: string,
  material: string,
  attachment: { dataB64: string; mediaType: string },
): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  if ((await aiDisabledSet()).has("doubt")) return null;
  // Reading a photographed question and solving it is the hardest thing the
  // site does for a student — it gets the teaching model, not the fast one.
  const model = await teachingModel();
  const isPdf = attachment.mediaType === "application/pdf";
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.dataB64 } }
    : { type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.dataB64 } };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        // Same house rules as every other doubt, and the same reason to cache
        // them: a photographed question usually arrives in the middle of a
        // conversation, so this prompt has very often just been sent.
        system: [{ type: "text", text: REPO_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: [
            // The attachment stays BELOW the breakpoint. It is a different
            // photograph every time, so there is nothing here to reuse.
            block,
            { type: "text", text: `STUDY MATERIAL:\n${material || "(none provided)"}\n\nThe attached ${isPdf ? "PDF" : "image"} is part of the student's doubt — read it carefully. STUDENT'S TYPED MESSAGE:\n${question || "(see the attachment)"}` },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage(
      "doubt", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0,
      Number(u.cache_read_input_tokens) || 0, Number(u.cache_creation_input_tokens) || 0,
    );
    const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
    return withBeta(text || null);
  } catch {
    return null;
  }
}

// From a student's recent questions, pull the specific CA topics/standards they
// seem to be struggling with — as short search terms to match against the catalog.
export async function extractConcepts(questionsText: string): Promise<string[]> {
  const sys =
    "From the student's questions below, list 2–5 specific CA exam topics, standards or concepts they seem to be struggling with. " +
    'Reply ONLY as a compact JSON array of short search terms, e.g. ["IND AS 115","revenue recognition","AS 24"]. No prose.';
  const out = await callClaude(sys, questionsText, 200, { model: await fastModel(), feature: "recommend" });
  if (!out) return [];
  try {
    const arr = JSON.parse(out.replace(/```json|```/g, "").trim());
    return Array.isArray(arr) ? arr.slice(0, 5).map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// A model/suggested answer a student could write to score full marks.
export async function suggestedAnswer(
  prompt: string,
  maxMarks: number,
  material: string,
): Promise<string | null> {
  const sys =
    "You are an ICAI exam expert for CA Parveen Sharma. Write a concise, well-structured MODEL ANSWER a student could write to score full marks for the question, using Indian CA exam conventions and citing the relevant standards/sections. Keep it proportional to the marks. If study material is provided, ground the answer in it.";
  const user = `QUESTION (${maxMarks} marks): ${prompt}` + (material ? `\n\nSTUDY MATERIAL:\n${material}` : "");
  return callClaude(sys, user, 1200, { feature: "suggested_answer" });
}

// AI mock interviewer for CA articleship/placement. The client passes the
// running transcript; we give brief feedback on the last answer + the next
// question, or a final assessment when the interview is ending.
export async function interviewReply(transcript: string): Promise<string | null> {
  const sys =
    "You are a professional but encouraging interviewer for a CA articleship/job at an Indian CA firm. " +
    "Conduct a realistic mock interview covering technical (accounting, audit, tax, law), practical and HR questions. " +
    "On each turn: give 1–2 lines of constructive feedback on the candidate's LAST answer, then ask exactly ONE next question. Keep it short. " +
    "If the transcript has 6 or more candidate answers, or contains 'END INTERVIEW', instead give a FINAL ASSESSMENT: strengths, what to improve, and a readiness score out of 10. " +
    "If the transcript is empty, just warmly greet and ask the first question.";
  return callClaude(sys, transcript || "(start the interview)", 600, { model: await fastModel(), feature: "interview" });
}

// Polish a CV summary/objective into crisp professional lines.
export async function improveSummary(text: string): Promise<string | null> {
  if (!text.trim()) return null;
  const sys =
    "Rewrite the following CA student's CV summary/objective into 2–3 crisp, professional sentences suitable for an Indian CA articleship/job CV. Keep it truthful to what's given; no fluff. Return only the rewritten text.";
  return callClaude(sys, text, 400, { model: await fastModel(), feature: "cv" });
}

const ASSIST_SYSTEM =
  "You are the WEBSITE / PORTAL assistant for CA Parveen Sharma's coaching site. " +
  "You ONLY handle questions about the website and logistics — courses, plans/fees, when classes or live sessions start, how to do something on the site, login/technical issues, contact. Answer ONLY from the SITE INFO section. " +
  "If the question is a CA SUBJECT DOUBT (a concept, problem, standard, section, numerical), DO NOT answer it — reply EXACTLY: " +
  "\"For subject doubts, please use the 'Ask your doubts' button on your subject page — it answers from your class material and can pass it to the faculty.\" " +
  "Answer in short bullet points (never paragraphs), warm and specific, under 100 words. " +
  "If the SITE INFO doesn't contain the answer, say you're not sure and point them to contact@caparveensharma.com. Never invent facts.";

// The "Ask me" assistant: handles both portal questions (from site facts) and
// CA doubts (from repository material) in one call. Returns the answer or the
// NEED_FACULTY sentinel (subject doubt not in material → send to faculty).
export async function answerAssistant(
  question: string,
  siteFacts: string,
  material: string,
): Promise<string | null> {
  const user = `SITE INFO:\n${siteFacts}\n\nSTUDY MATERIAL:\n${material || "(none provided)"}\n\nQUESTION:\n${question}`;
  return withBeta(await callClaude(ASSIST_SYSTEM, user, 700, { model: await teachingModel(), feature: "ask_me" }));
}

// Pre-generate MCQs from a class transcript (token-frugal: run ONCE at upload
// time, store the questions, serve them statically to every student). Returns
// null when AI is unconfigured or the response can't be parsed.
export async function generateMcqs(
  transcript: string,
  count: number,
  topic?: string,
): Promise<
  { question: string; options: string[]; correct_index: number; why_correct: string; why_wrong: string[]; concept: string }[] | null
> {
  const n = Math.max(1, Math.min(25, Math.round(count) || 10));
  const system =
    `You are an ICAI exam question setter for CA Parveen Sharma. ` +
    `From the lecture transcript, write exactly ${n} exam-style multiple-choice questions for Indian CA students` +
    (topic ? ` on "${topic}"` : "") +
    `. Each question has exactly 4 options with ONE correct answer. Test conceptual understanding and application (not trivia); use Indian accounting/tax/law context and reference standards/sections where useful. ` +
    `Tag each question with the single "concept" it tests. ` + NOT_TAUGHT +
    `For EACH question also explain WHY the correct option is correct, and for EACH option a short reason WHY it is right or wrong. Keep EVERY explanation to ONE short line under 25 words (no paragraphs). ` +
    `Respond ONLY as compact JSON, no prose, no code fences, ASCII punctuation only: ` +
    `{"questions":[{"concept":"...","question":"...","options":["...","...","...","..."],"correct_index":0,"why_correct":"...","why_options":["why opt1","why opt2","why opt3","why opt4"]}]} ` +
    `where correct_index is the 0-based index of the correct option and why_options has one reason per option in the same order.`;
  const user = `Transcript:\n${transcript.slice(0, 24000)}`;
  const text = await callClaude(system, user, 6000, { feature: "generate_mcq" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { question?: unknown; options?: unknown; correct_index?: unknown; why_correct?: unknown; why_options?: unknown; concept?: unknown }) => {
        const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean);
        const why_wrong = (Array.isArray(q.why_options) ? q.why_options : []).map((o) => String(o ?? "").trim());
        return {
          concept: String(q.concept ?? "").trim(),
          question: String(q.question ?? "").trim(),
          options,
          correct_index: Number.isInteger(q.correct_index) ? (q.correct_index as number) : 0,
          why_correct: String(q.why_correct ?? "").trim(),
          why_wrong,
        };
      })
      .filter((q) => q.question && q.options.length >= 2 && q.correct_index < q.options.length);
  } catch {
    return null;
  }
}

// ---- Case-study engine ----
// Parse ONE chunk of a case-studies PDF into structured cases. The PDF has
// numbered case scenarios, each followed by 5-7 MCQs, with the correct answers
// given in the PDF (after each question, after the case, or in an answer key).
// The model must return only COMPLETE cases and say how much of the chunk it
// consumed, so the driver can resume exactly where the last full case ended.
export type ParsedCase = {
  title: string;
  scenario: string;
  questions: { question: string; options: string[]; correct_index: number }[];
};
// Parse model JSON that may be wrapped in code fences OR truncated at the token
// limit. On a clean parse failure, salvage by trimming to the last complete
// object/array close — so a cut-off response still yields the cases it did emit.
export function parseLooseJson(text: string): any | null {
  let s = text.replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  if (start > 0) s = s.slice(start);
  try { return JSON.parse(s); } catch { /* try salvage */ }
  // Salvage a truncated array — the response ran out of tokens mid-object, so
  // keep the whole objects it did emit and drop the half-written one. Applies
  // to case sets and to campaign packs alike.
  for (const key of ["cases", "posts"]) {
    const salvaged = salvageArray(s, key);
    if (salvaged) return salvaged;
  }
  return null;
}

function salvageArray(s: string, key: string): Record<string, unknown> | null {
  const m = s.match(new RegExp(`"${key}"\\s*:\\s*\\[`));
  if (!m) return null;
  const arrStart = (m.index ?? 0) + m[0].length;
  const objs: string[] = [];
  let depth = 0, objStart = -1, inStr = false, esc = false;
  for (let i = arrStart; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && objStart >= 0) { objs.push(s.slice(objStart, i + 1)); objStart = -1; } }
    else if (ch === "]" && depth === 0) break;
  }
  if (!objs.length) return null;
  try { return { [key]: JSON.parse(`[${objs.join(",")}]`), consumed_chars: 0 }; } catch { return null; }
}

// "AI_DOWN" = the model call itself failed (no key / API error / rate limit) —
// caller should retry later, NOT skip content. null = we got a response but
// couldn't parse it (content problem) — caller may skip past it.
export async function parseCaseStudiesChunk(
  chunk: string,
  isLastChunk: boolean,
): Promise<{ cases: ParsedCase[]; consumed: number } | "AI_DOWN" | null> {
  const system =
    `You extract case studies from an Indian CA exam PDF (text below). The document contains numbered ` +
    `case-study scenarios, each followed by about 5-7 multiple-choice questions; the correct answers are ` +
    `stated in the document (marked with the question, listed after the case, or in an answer key). ` +
    `Extract every COMPLETE case study in this text chunk. Keep the scenario text faithful to the source ` +
    `(you may clean line-break artifacts). Each question: full text, all options in order, and the 0-based ` +
    `index of the correct option AS GIVEN IN THE DOCUMENT (never guess; if truly absent use -1). ` +
    (isLastChunk
      ? `This is the FINAL chunk — extract everything remaining. Set "consumed_chars" to the chunk length. `
      : `The chunk may END MID-CASE: exclude any incomplete trailing case, and set "consumed_chars" to the ` +
        `character offset where the last complete case ends, so parsing resumes there. `) +
    `Respond ONLY as compact JSON, no prose, no code fences: ` +
    `{"cases":[{"title":"Case 12 — <short name>","scenario":"...","questions":[{"question":"...","options":["...","..."],"correct_index":0}]}],"consumed_chars":12345}`;
  const text = await callClaude(system, chunk, 16000, { feature: "case_parse" });
  if (!text) return "AI_DOWN"; // API/config error — retry later, don't skip
  try {
    const json = parseLooseJson(text);
    if (!json) return null;
    const arr = Array.isArray(json.cases) ? json.cases : [];
    const cases: ParsedCase[] = arr
      .map((c: { title?: unknown; scenario?: unknown; questions?: unknown }) => ({
        title: String(c.title ?? "").trim(),
        scenario: String(c.scenario ?? "").trim(),
        questions: (Array.isArray(c.questions) ? c.questions : [])
          .map((q: { question?: unknown; options?: unknown; correct_index?: unknown }) => ({
            question: String(q.question ?? "").trim(),
            options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
            correct_index: Number.isInteger(q.correct_index) ? (q.correct_index as number) : -1,
          }))
          .filter((q: { question: string; options: string[] }) => q.question && q.options.length >= 2),
      }))
      .filter((c: ParsedCase) => c.scenario && c.questions.length > 0);
    const consumed = Number(json.consumed_chars);
    return { cases, consumed: Number.isFinite(consumed) && consumed > 0 ? Math.min(consumed, chunk.length) : chunk.length };
  } catch {
    return null;
  }
}

// Generate the per-question reasons for ONE case (why the correct option is
// right + why each option is right/wrong). Run once per case, cached in the DB.
export async function explainCaseAnswers(
  scenario: string,
  questions: { question: string; options: string[]; correct_index: number }[],
): Promise<{ why_correct: string; why_options: string[] }[] | null> {
  const system =
    `You are CA Parveen Sharma's teaching assistant. For each MCQ of this case study, explain in ` +
    `1-2 short lines WHY the correct option is correct, and for EVERY option one short line why it is ` +
    `right or wrong (cite the accounting standard / provision where useful). Respond ONLY as compact JSON: ` +
    `{"explanations":[{"why_correct":"...","why_options":["reason opt 1","reason opt 2",...]}]} ` +
    `— one entry per question, why_options in the same order as the options.`;
  const user =
    `CASE:\n${scenario.slice(0, 8000)}\n\nQUESTIONS:\n` +
    questions.map((q, i) => `${i + 1}. ${q.question}\nOptions: ${q.options.map((o, j) => `(${j + 1}) ${o}`).join(" ")}\nCorrect: option ${q.correct_index + 1}`).join("\n\n");
  const text = await callClaude(system, user, 4000, { feature: "case_explain" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json.explanations) ? json.explanations : [];
    return arr.map((e: { why_correct?: unknown; why_options?: unknown }) => ({
      why_correct: String(e.why_correct ?? "").trim(),
      why_options: (Array.isArray(e.why_options) ? e.why_options : []).map((o) => String(o ?? "").trim()),
    }));
  } catch {
    return null;
  }
}

// Pre-generate descriptive (subjective) exam questions from a transcript.
export async function generateSubjectiveQuestions(
  transcript: string,
  count: number,
  topic?: string,
): Promise<{ prompt: string; max_marks: number; model_answer: string }[] | null> {
  const n = Math.max(1, Math.min(15, Math.round(count) || 5));
  const system =
    `You are an ICAI exam paper setter for CA Parveen Sharma. ` +
    `From the lecture transcript, write exactly ${n} descriptive/long-form CA exam questions for Indian CA students` +
    (topic ? ` on "${topic}"` : "") +
    `. Mix practical/numerical and conceptual questions in ICAI exam style; assign realistic marks (4-16 each). ` +
    `For EACH question also provide a concise MODEL ANSWER a student could write to score full marks (exam conventions, cite standards/sections). ` + NOT_TAUGHT +
    `Respond ONLY as compact JSON, no prose, no code fences: ` +
    `{"questions":[{"prompt":"...","max_marks":8,"model_answer":"..."}]}.`;
  const user = `Transcript:\n${transcript.slice(0, 24000)}`;
  const text = await callClaude(system, user, 6000, { feature: "generate_subjective" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { prompt?: unknown; max_marks?: unknown; model_answer?: unknown }) => ({
        prompt: String(q.prompt ?? "").trim(),
        max_marks: Number.isFinite(Number(q.max_marks)) ? Math.max(1, Math.min(100, Math.round(Number(q.max_marks)))) : 10,
        model_answer: String(q.model_answer ?? "").trim(),
      }))
      .filter((q) => q.prompt.length > 0);
  } catch {
    return null;
  }
}

export async function gradeSubjective(
  prompt: string,
  answer: string,
  maxMarks: number | null,
  rubric?: { point: string; marks: number }[] | null,
  modelAnswer?: string | null,
): Promise<{ score: number | null; feedback: string } | null> {
  const mm = maxMarks ?? 10;
  const scheme = (rubric ?? []).filter((r) => r && r.point);
  const schemeText = scheme.length
    ? `\n\nMarking scheme — award marks STRICTLY against these points (do not invent your own):\n${scheme.map((r) => `- ${r.point} (${r.marks} marks)`).join("\n")}`
    : "";
  const modelText = modelAnswer ? `\n\nModel answer (the ideal answer to compare against):\n${modelAnswer}` : "";
  const system =
    `You are an ICAI subject examiner for CA Parveen Sharma. Evaluate the student's answer the way a CA exam examiner would, out of ${mm} marks. ` +
    (scheme.length
      ? `Award marks point-by-point using ONLY the marking scheme provided; the feedback must say which points were earned and which were missed. `
      : "") +
    `Respond ONLY as compact JSON, no prose, no code fences: {"score": <integer 0-${mm}>, "feedback": "<a short structured report: ✅ What was correct: …; ❌ What was wrong/missing: …; 📘 Concept to revise: <name the specific concept/standard/section>; 🎯 How to improve: <one concrete next step / what to study again>>"}.`;
  const user = `Question (max ${mm} marks): ${prompt}${schemeText}${modelText}\n\nStudent's answer:\n${answer}`;
  const text = await callClaude(system, user, 700, { feature: "grade" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const score =
      typeof json.score === "number" ? Math.max(0, Math.min(mm, Math.round(json.score))) : null;
    return { score, feedback: String(json.feedback ?? "").trim() };
  } catch {
    return { score: null, feedback: text.slice(0, 800) };
  }
}

export const JOB_CATEGORIES = ["Articleship", "Fresher CA", "Experienced CA", "Industry / Corporate", "Audit firm", "Internship", "Other"] as const;

// Categorise an opening from its title/snippet with reliable keyword rules
// (instant, free, and consistent — beats an LLM that often returns "Other").
export function categorizeJob(title: string, snippet?: string): string {
  const t = `${title} ${snippet ?? ""}`.toLowerCase();
  if (/article\s?ship|article\s?assistant|article\s?trainee|ca\s?article/.test(t)) return "Articleship";
  if (/\bintern(ship)?\b/.test(t)) return "Internship";
  if (/manager|senior|sr\.?\b|lead|head|director|controller|principal|experienced|[5-9]\+?\s*years?|1[0-9]\s*years?/.test(t)) return "Experienced CA";
  if (/fresher|trainee|entry[-\s]?level|graduate|0\s*-\s*[12]\s*years?|qualified ca/.test(t)) return "Fresher CA";
  if (/audit|assurance|ca firm|chartered accountant firm|articled/.test(t)) return "Audit firm";
  if (/finance|account|taxation|gst|analyst|industry|corporate|controller|treasury/.test(t)) return "Industry / Corporate";
  return "Other";
}

// Batch helper (kept async for the existing call site). No AI cost.
export async function classifyJobs(jobs: { title: string; company?: string; snippet?: string }[]): Promise<string[]> {
  return jobs.map((j) => categorizeJob(j.title, j.snippet));
}

// Convert a handwritten-notes PDF into clean typed notes (Markdown) using
// Claude's vision. Run ONCE at admin level; the result goes to faculty for
// approval before students see it.
export async function transcribeHandwriting(pdfUrl: string, opts: { force?: boolean } = {}): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !pdfUrl) return null;
  // The realtime "transcribe" toggle gates the on-demand admin button; the
  // background knowledge-ingestion pass sets force:true to feed the AI regardless.
  if (!opts.force && (await aiDisabledSet()).has("transcribe")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    // "secure:<path>" refs (files behind login) must be signed before fetching;
    // public URLs pass through unchanged.
    const { resolveFileUrl } = await import("@/lib/storage");
    const fetchable = await resolveFileUrl(pdfUrl);
    if (!fetchable) return null;
    const pdfRes = await fetch(fetchable, { cache: "no-store" });
    if (!pdfRes.ok) return null;
    const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system:
          "You convert handwritten CA class notes into clean, well-structured TYPED notes in Markdown. " +
          "Preserve headings, sub-points, numbering, formulas, journal entries and the original order. " +
          "Use Indian CA conventions. Output ONLY the typed notes — no commentary, no preamble.",
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: "Convert these handwritten notes into clean typed notes." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("transcribe", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

// Read a teacher-supplied MCQ test PDF and convert it into engine questions —
// ONCE, at upload. This is pure DIGITISATION: it extracts exactly what the PDF
// contains and NEVER solves, judges, corrects, adds, removes or rewords anything.
// The correct option is whatever the document marks as the answer (the teacher's
// own answer key) — even if that answer is wrong, it is kept as-is. Any solution
// text in the PDF is copied faithfully. Returns null when AI is off / PDF unreadable.
export type ExtractedMcq = {
  question: string;
  options: string[];
  correct_index: number; // 0-based into options; -1 if the PDF marks no answer
  concept: string;
  solution: string;
};
export async function extractMcqsFromPdf(pdfUrl: string): Promise<ExtractedMcq[] | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !pdfUrl) return null;
  if ((await aiDisabledSet()).has("import_mcq_pdf")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  const sys =
    "You DIGITISE a multiple-choice test that the teacher (CA Parveen Sharma) has ALREADY written, with the correct answers ALREADY marked. " +
    "Your ONLY job is faithful extraction. You MUST NOT solve the questions, MUST NOT judge, correct or change the marked answer, and MUST NOT add, remove, reword or 'fix' any question, option, answer or solution — even if you believe an answer is wrong, keep EXACTLY what the teacher wrote and marked. " +
    "Identify the correct option only from how the document marks it (a tick/✓/star, bold, underline, 'Ans:', 'Answer:', or a separate answer key). " +
    "If a question has NO answer marked anywhere in the document, set correct_index to -1 (do NOT guess an answer). " +
    "If the document provides a solution/explanation for a question, copy it faithfully into 'solution' (keep it concise but do not invent); otherwise leave 'solution' empty. " +
    "If a topic/concept/standard/section is stated for a question, put it in 'concept'; otherwise leave it empty. " +
    "Respond ONLY as compact JSON, no prose, no code fences: " +
    '{"questions":[{"question":"...","options":["...","...","...","..."],"correct_index":0,"concept":"","solution":""}]} ' +
    "where correct_index is the 0-based index into options of the answer the document marks.";
  try {
    const { resolveFileUrl } = await import("@/lib/storage");
    const fetchable = await resolveFileUrl(pdfUrl);
    if (!fetchable) return null;
    const pdfRes = await fetch(fetchable, { cache: "no-store" });
    if (!pdfRes.ok) return null;
    const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: "Extract every MCQ from this test exactly as written, with the answer the document marks." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("import_mcq_pdf", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    if (!text) return null;
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { question?: unknown; options?: unknown; correct_index?: unknown; concept?: unknown; solution?: unknown }) => {
        const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean);
        const ci = Number.isInteger(q.correct_index) ? (q.correct_index as number) : -1;
        return {
          question: String(q.question ?? "").trim(),
          options,
          correct_index: ci,
          concept: String(q.concept ?? "").trim(),
          solution: String(q.solution ?? "").trim(),
        };
      })
      .filter((q) => q.question && q.options.length >= 2);
  } catch {
    return null;
  }
}

// Grade a student's HANDWRITTEN answer paper (PDF of photos) against the
// teacher's official solution PDF — ONCE, when they submit. Claude reads the
// handwriting (vision), matches it to the official solution and ICAI marking
// conventions, and returns per-question marks + improvement points + concepts to
// revise. It never invents answers the student didn't write. null when off/unreadable.
export type PaperAnnotation = { page: number; y: number; kind: "right" | "wrong" | "partial" | "tip"; note: string };
export type DescriptiveGrade = {
  awarded: number;
  total: number;
  summary: string;
  per_question: {
    q: string; awarded: number; max: number; comment: string;
    /** Which steps of the marking guide earned marks. The totals are added up
     *  from these, not taken from the marker's own arithmetic. */
    steps?: { step: string; max: number; awarded: number }[];
  }[];
  improvements: string[];
  concepts_to_revise: string[];
  annotations: PaperAnnotation[];
  unreadable: boolean;
};
// Draft a full worked answer key for an uploaded question paper. The paper's
// extracted text goes in; a solution a student could write to score full marks
// comes out. Long papers arrive in numbered parts — each pass answers ONLY the
// questions it can see, so the parts join into one continuous key.
export async function draftPaperSolution(input: {
  paperTitle: string;
  subject: string;
  questionText: string;
  part: number;
  totalParts: number;
}): Promise<string | null> {
  const { paperTitle, subject, questionText, part, totalParts } = input;
  const system =
    "You are CA Parveen Sharma's answer-key writer for Indian CA exams. " +
    "You are given the TEXT OF A QUESTION PAPER. Write the SUGGESTED ANSWERS exactly as ICAI's suggested answers are written: " +
    "question number, then the complete worked answer a student could reproduce to score FULL marks. " +
    "For numericals show every working — journal entries, ledger/working notes, formats and totals — and label working notes. " +
    "For theory answer in exam points, citing the accounting standard, Ind AS, section or rule that governs it. " +
    "State any assumption you make explicitly, the way an examiner accepts it. " +
    ICAI_LAYOUT +
    "NEVER invent a question that is not in the text, and never skip a question that is. " +
    "If a question's data is incomplete in the extract, answer as far as the data allows and say what is missing — do not fabricate figures. " +
    NOT_TAUGHT +
    (totalParts > 1
      ? `This is PART ${part} of ${totalParts} of the paper. Answer ONLY the questions visible in this part; do not repeat earlier parts and do not write an introduction or conclusion. `
      : "") +
    " Output plain text only — no markdown of any kind, no code fences.";
  const user = `Subject: ${subject || "CA"}\nPaper: ${paperTitle}\n\nQuestion paper text:\n${questionText}`;
  return callClaude(system, user, 8000, { feature: "draft_solution" });
}

// Draft an answer key straight from the QUESTION PAPER PDF.
//
// The descriptive tests have no extracted text — only the paper itself — so
// the text-based drafter above could never touch them. This reads the PDF the
// way an examiner would and writes the suggested answers from it.
export async function draftSolutionFromPdf(input: {
  paperTitle: string;
  subject: string;
  questionPdfUrl: string;
  totalMarks?: number | null;
}): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !input.questionPdfUrl) return null;
  if ((await aiDisabledSet()).has("draft_solution")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const res0 = await fetch(input.questionPdfUrl, { cache: "no-store" });
    if (!res0.ok) {
      console.error("[draft_solution] cannot read question paper", res0.status);
      return null;
    }
    const buf = await res0.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) {
      console.error("[draft_solution] question paper too large", buf.byteLength);
      return null;
    }
    const b64 = Buffer.from(buf).toString("base64");

    const system =
      "You are CA Parveen Sharma's answer-key writer for Indian CA exams. " +
      "You are given a QUESTION PAPER as a PDF. Write the SUGGESTED ANSWERS exactly as ICAI's suggested answers are written: " +
      "question number, then the complete worked answer a student could reproduce to score FULL marks. " +
      "For numericals show every working — journal entries, ledger and working notes, formats and totals — and label the working notes. " +
      "For theory answer in exam points, citing the Accounting Standard, Ind AS, section or rule that governs it. " +
      "State any assumption explicitly, the way an examiner accepts it. " +
      ICAI_LAYOUT +
      "Answer EVERY question in the paper and never invent one that is not there. " +
      "If a question's data is genuinely incomplete, answer as far as it allows and say what is missing — never fabricate figures. " +
      (input.totalMarks ? `The paper carries ${input.totalMarks} marks; show the marks against each answer. ` : "") +
      NOT_TAUGHT +
      " Output plain text only — no markdown of any kind, no code fences.";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `Subject: ${input.subject || "CA"}\nTest: ${input.paperTitle}\n\nWrite the full suggested answers for this question paper.` },
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[draft_solution] Anthropic refused", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("draft_solution", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (e) {
    console.error("[draft_solution] failed", e instanceof Error ? e.message : e);
    return null;
  }
}

// Is this message worth answering at all?
//
// The bot was replying to "Hi", "classes", "Ka batao" and half-typed lines as
// earnestly as to a real doubt, which trains students to treat it as a toy and
// costs money on every shrug. It now answers a QUESTION, stays silent on
// chatter, and warns once on anything abusive.
export type MessageJudgement = { kind: "question" | "chatter" | "abusive"; why: string };

export async function judgeStudentMessage(text: string): Promise<MessageJudgement> {
  const t = (text ?? "").trim();
  // Cheap certainties first — no reason to pay for a model call on "hi".
  if (t.length < 12) return { kind: "chatter", why: "too short to be a question" };

  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return { kind: "question", why: "no key — err on the side of answering" };

  const system =
    "You sort messages sent to a CA (Indian chartered accountancy) coaching study group. " +
    "Reply with ONE word and nothing else:\n" +
    "question - a genuine study or course question that can be answered: a topic, a standard, a sum, " +
    "a doubt about the classes, tests, notes, schedule, fees or access. A short or badly typed question " +
    "still counts, including Hinglish. So does a follow-up that makes sense on its own.\n" +
    "chatter - a greeting, thanks, a single word, an unfinished sentence, small talk, or a message with " +
    "no answerable question in it.\n" +
    "abusive - abuse, obscenity, insults, threats, harassment, or deliberate spam.\n" +
    "\nSTUDENT VOCABULARY. These are ordinary words here and are NEVER abuse:\n" +
    "  'hit list' / 'hitlist' = the list of most-important questions to do. It is the single most " +
    "requested thing on this channel. A student asking for the hit list is asking for study material.\n" +
    "  'kill' / 'killer' question, 'attack' a paper, 'crack' the exam, 'target', 'shoot me the notes', " +
    "'MIQ', 'ABC analysis' — all normal exam talk.\n" +
    "A message is abusive only if the ABUSE IS AIMED AT A PERSON. Alarming-sounding study vocabulary " +
    "is not abuse. If you are unsure, it is not abusive.\n" +
    "If it could reasonably be a question, say question.";

  const raw = await callClaude(system, t.slice(0, 1500), 8, {
    model: await fastModel(),
    feature: "judge_message",
  });
  const word = String(raw ?? "").toLowerCase();
  if (word.includes("chatter")) return { kind: "chatter", why: "no answerable question" };
  if (!word.includes("abusive")) return { kind: "question", why: "answerable" };

  // ACCUSING SOMEBODY OF ABUSE NEEDS MORE THAN ONE OPINION.
  //
  // A student asked "Can you provide me the hit list" and was told his access
  // would be withdrawn. One model call, one word, no appeal, and a paying
  // student is accused of abuse and threatened. The cost of the two mistakes is
  // nowhere near equal: answering an insult politely costs nothing, while
  // threatening a student who asked for study material can lose them for good.
  //
  // So a second opinion is asked, from a stricter question, and both must
  // agree. A single call can no longer produce a warning.
  const confirm = await callClaude(
    "You review a moderation decision for a CA coaching study group. Another system flagged the " +
      "message below as abusive. Is that RIGHT?\n" +
      "Answer YES only if the message contains abuse, obscenity, insults, threats or harassment " +
      "AIMED AT A PERSON, or is deliberate spam.\n" +
      "Answer NO if it is a study or course question, however oddly worded — including exam slang " +
      "like 'hit list' (the most-important-questions list), 'killer question' or 'crack the exam'.\n" +
      "Reply with one word: YES or NO. If you are not sure, answer NO.",
    t.slice(0, 1500),
    8,
    { model: await fastModel(), feature: "judge_message" },
  );
  if (!/\byes\b/i.test(String(confirm ?? ""))) {
    // The two disagreed, so the student is given the benefit of it and the
    // message is answered like any other.
    return { kind: "question", why: "flagged, but not confirmed on review" };
  }
  return { kind: "abusive", why: "flagged as abusive, and confirmed on review" };
}

// Said once, plainly, and only where it belongs.
//
// This was written for the study groups and then sent down a one-to-one
// WhatsApp thread, so a student messaging us privately was told off for how he
// behaves "here" in a group he was not in — and threatened with losing access
// to it. Each channel now says the true thing.
/**
 * Is this student in real distress, or is it exam talk?
 *
 * Asked only when a softer word has already appeared, so this is not a cost on
 * every message. The instruction leans toward YES: an unnecessary offer of help
 * is a small awkwardness, a missed one is not something that can be put right
 * afterwards.
 */
export async function judgeDistress(text: string): Promise<boolean> {
  const out = await callClaude(
    "A student at a CA (Indian chartered accountancy) coaching institute sent the message below.\n" +
      "Is this person expressing REAL distress about themselves — despair, depression, hopelessness, " +
      "not coping, self-harm, or thoughts of ending their life?\n" +
      "Answer NO for ordinary exam pressure and student hyperbole: 'this paper killed me', 'I'm dying', " +
      "'mar gaya', 'I failed again', 'this subject is impossible', complaints about difficulty or marks.\n" +
      "Answer NO when the words appear ACADEMICALLY rather than about themselves — 'what is the suicide " +
      "clause in a life insurance policy', 'treatment of death benefit under Ind AS 104', a question about " +
      "a case law or a section. Those are textbook questions, not a person in trouble.\n" +
      "Answer YES if a real person sounds genuinely unwell or unsafe, even if they are also asking a " +
      "study question in the same message.\n" +
      "If you are genuinely unsure, answer YES — the cost of missing this is far higher than the cost " +
      "of an unnecessary offer of help.\n" +
      "Reply with one word: YES or NO.",
    text.slice(0, 1500),
    8,
    { model: await fastModel(), feature: "judge_message" },
  );
  return /\byes\b/i.test(String(out ?? ""));
}

/**
 * Has this exchange run its course?
 *
 * Leans toward NO. Ending a conversation early — sending "glad that helped"
 * while the student is mid-thought — is far more irritating than never sending
 * it at all, and it is the sort of thing that makes a person stop writing in.
 */
export async function judgeConversationEnded(history: string, latest: string): Promise<boolean> {
  const out = await callClaude(
    "You are reading a conversation between a CA coaching institute and a student.\n" +
      "Has it FINISHED — the student's question was answered and they are satisfied or signing off?\n" +
      "Answer YES only for a clear ending: 'thanks sir', 'got it', 'ok clear', 'thank you so much', " +
      "'that helps', or a plain acknowledgement with nothing left open.\n" +
      "Answer NO if they asked anything new, asked a follow-up, sound confused, are waiting on " +
      "something from us, mentioned a payment or access problem, or said anything about how they " +
      "are feeling. Answer NO if the last message is a question of any kind.\n" +
      "If you are unsure at all, answer NO.\n" +
      "Reply with one word: YES or NO.",
    `${history}\n\nStudent's latest message:\n${latest}`.slice(0, 4000),
    8,
    { model: await fastModel(), feature: "judge_message" },
  );
  return /\byes\b/i.test(String(out ?? ""));
}

/**
 * Is our subject being sold inside somebody else's package?
 *
 * A reseller may sell Financial Reporting or Advanced Accounting on their own
 * shopfront. They may not bundle it with another faculty's paper — his name
 * becoming part of a package he never agreed to.
 *
 * Leans hard toward NO. This feeds a compliance record about a real business
 * relationship, and a false accusation of cheating costs far more than a missed
 * one, which a person will catch on the next look anyway.
 */
export async function judgeSupporterPage(
  text: string,
): Promise<{ combo: boolean; why?: string; evidence?: string } | null> {
  const out = await callClaude(
    "You are reading a coaching reseller's web page. They are allowed to sell CA Parveen Sharma's " +
      "Financial Reporting and Advanced Accounting on their own site.\n" +
      "Answer ONE question: is a CA Parveen Sharma subject being sold BUNDLED or COMBINED with a " +
      "DIFFERENT teacher's course — a combo, a package, 'buy both', two faculty in one price?\n" +
      "Answer NO if his courses are merely listed on the same page as other teachers' courses. A " +
      "catalogue is not a bundle. Answer NO if you are unsure at all.\n" +
      "Answer YES only when one price plainly buys his subject together with another teacher's.\n" +
      'Reply as JSON: {"combo": true|false, "why": "one sentence", "evidence": "the exact words on ' +
      'the page that show it"}',
    text,
    300,
    { model: await fastModel(), feature: "other" },
  );
  const j = parseLooseJson(String(out ?? ""));
  if (!j || typeof j.combo !== "boolean") return null;
  return { combo: j.combo, why: String(j.why ?? ""), evidence: String(j.evidence ?? "") };
}

export const ABUSE_WARNING =
  "This is a study group for CA Intermediate and CA Final students. " +
  "Messages like that are not acceptable here.\n\n" +
  "Please keep to your studies. If it happens again, your access to this group will be withdrawn.\n\n" +
  "— CA Parveen Sharma Classes";

/** The same point, for a private message, and without a threat attached. */
export const ABUSE_WARNING_DIRECT =
  "We are happy to help with anything about your classes, tests or notes. " +
  "Please keep messages on this number to that.\n\n" +
  "— CA Parveen Sharma Classes";

// Is this "official solution" actually a typeset document, or somebody's
// scanned handwritten copy?
//
// A student's answer book had been uploaded as the official answer on at least
// one test — so students opening the solution saw another student's
// handwriting instead of a proper key. Only the FIRST PAGE is sent: enough to
// tell, and it keeps a 13 MB scan from costing 13 MB of tokens.
// DOES THE ANSWER KEY BELONG TO THIS QUESTION PAPER?
//
// Nothing in this system ever asked that. The examiner is handed the student's
// answer book and the key — never the question paper — so if the wrong key is
// attached to a test, the marker has no way to know: it simply reports that
// the student answered none of the questions and gives a zero. The solution
// audit does not catch it either; that only asks whether the key is typeset or
// a handwritten scan, which says nothing about WHICH paper it answers.
//
// One student sat a cash flow paper, answered it, and was given 0 out of 17
// with the note that she had "not answered the questions". She had. She was
// the only person to have taken that paper, so nothing looked odd in any
// average, and it took her writing in three times to be heard.
//
// Only the first two pages of each go — enough to see what is being asked and
// what is being answered, without paying for two full scans.
// THE SAME QUESTION, WHERE THE KEY IS TEXT RATHER THAN A PDF.
//
// Fifty-one of the tests here have no uploaded solution at all — their key was
// written by us from the question paper and approved. Every Financial Reporting
// paper is in that group. A key written FROM the paper cannot be a key to a
// different paper, so the wrong-file fault is impossible there; what is very
// possible is that it stops after Q2 of a three-question paper, and that costs
// a student exactly as many marks as the wrong file does on that question.
//
// So the same comparison, with the key supplied as text.
export async function classifyKeyTextCoversPaper(
  questionPdfUrl: string,
  keyText: string,
): Promise<{ verdict: KeyMatchVerdict; note: string }> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !questionPdfUrl || !keyText.trim()) return { verdict: "unclear", note: "not enough to compare" };
  try {
    const r = await fetch(questionPdfUrl, { cache: "no-store" });
    if (!r.ok) return { verdict: "unclear", note: "the question paper could not be opened" };
    const full = new Uint8Array(await r.arrayBuffer());
    let head: Uint8Array = full;
    try {
      const { PDFDocument } = await import("pdf-lib");
      const src = await PDFDocument.load(full, { ignoreEncryption: true });
      const n = Math.min(3, src.getPageCount());
      if (n === 0) return { verdict: "unclear", note: "the question paper has no pages" };
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, Array.from({ length: n }, (_, i) => i));
      for (const pg of pages) out.addPage(pg);
      head = await out.save();
    } catch {
      return { verdict: "unclear", note: "the question paper could not be read" };
    }
    if (head.byteLength > 18 * 1024 * 1024) return { verdict: "unclear", note: "the question paper is too large to compare" };

    const system =
      "You are given a CA test's QUESTION PAPER as a PDF, and the text of the ANSWER KEY written for it. " +
      "Do not judge quality and do not award anything. Report only what each contains.\n" +
      "For the QUESTION PAPER list every question: its number, the marks printed for it, and a few words naming its " +
      "subject matter, including any company or person name used.\n" +
      "For the KEY list every question it actually answers, the same way.\n" +
      "Then for each question in the PAPER say whether the key answers it — match on names and figures, not on " +
      "question numbers, which often differ.\n" +
      "Respond ONLY as compact JSON, no prose, no code fences:\n" +
      '{"paper":[{"n":"Q1","marks":5,"about":"..."}],"key":[{"n":"Q1","about":"..."}],' +
      '"answered":[{"paper_q":"Q1","in_key":true,"why":"..."}]}';

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: await fastModel(),
        max_tokens: 1500,
        temperature: 0,
        system,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(head).toString("base64") } },
            { type: "text", text: `THE ANSWER KEY:\n\n${keyText.slice(0, 60_000)}` },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[key_match_text] Anthropic refused", res.status, (await res.text()).slice(0, 200));
      return { verdict: "unclear", note: "the comparison could not be run" };
    }
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("key_match", await fastModel(), Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const raw = String(data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw) as {
      paper?: { n?: string }[]; key?: { n?: string; about?: string }[];
      answered?: { paper_q?: string; in_key?: boolean }[];
    };
    const paper = parsed.paper ?? [], key = parsed.key ?? [], answered = parsed.answered ?? [];
    if (paper.length === 0 || key.length === 0) {
      return { verdict: "unclear", note: "the questions could not be read" };
    }
    const missing = answered.filter((a) => a.in_key === false).map((a) => String(a.paper_q ?? "?"));
    const covered = answered.filter((a) => a.in_key === true).length;
    if (covered === 0) {
      return { verdict: "mismatch", note: `The key answers none of this paper's ${paper.length} question(s).` };
    }
    if (missing.length > 0) {
      return {
        verdict: "incomplete",
        note: `The key has no answer for ${missing.join(", ")} — a student who answers ${missing.length === 1 ? "it" : "those"} scores nothing for ${missing.length === 1 ? "it" : "them"}.`,
      };
    }
    return { verdict: "match", note: `All ${paper.length} question(s) are answered by the key.` };
  } catch (e) {
    console.error("[key_match_text] failed", e instanceof Error ? e.message : e);
    return { verdict: "unclear", note: "the comparison could not be run" };
  }
}

export type KeyMatchVerdict = "match" | "incomplete" | "mismatch" | "unclear";

export async function classifyKeyMatchesPaper(
  questionPdfUrl: string,
  solutionPdfUrl: string,
): Promise<{ verdict: KeyMatchVerdict; note: string }> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !questionPdfUrl || !solutionPdfUrl) return { verdict: "unclear", note: "not enough to compare" };
  try {
    const head = async (url: string): Promise<Uint8Array | null> => {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      const full = new Uint8Array(await r.arrayBuffer());
      try {
        const { PDFDocument } = await import("pdf-lib");
        const src = await PDFDocument.load(full, { ignoreEncryption: true });
        const n = Math.min(3, src.getPageCount());
        if (n === 0) return null;
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, Array.from({ length: n }, (_, i) => i));
        for (const pg of pages) out.addPage(pg);
        return await out.save();
      } catch {
        return null;
      }
    };
    const [q, sol] = await Promise.all([head(questionPdfUrl), head(solutionPdfUrl)]);
    if (!q || !sol) return { verdict: "unclear", note: "one of the two files could not be opened" };
    if (q.byteLength + sol.byteLength > 20 * 1024 * 1024) return { verdict: "unclear", note: "files too large to compare" };

    // ASK FOR FACTS, NOT FOR A VERDICT.
    //
    // The first version of this asked "do these match?" and got six flags out
    // of six papers — because a key that answers Q1 but not Q2 feels like a
    // mismatch to a reader, however firmly the instructions say otherwise. A
    // tool that flags everything is a tool nobody reads.
    //
    // So the model is asked only what it can see: which questions the paper
    // sets, and which of them the key answers. The verdict is worked out here,
    // in code, where the rule is written once and cannot drift with the mood of
    // a prompt. The two faults are genuinely different and want different
    // answers from a teacher:
    //
    //   mismatch   the key answers questions this paper does not ask. The wrong
    //              file is attached, and everyone who sits it scores near zero.
    //   incomplete the key is for this paper but stops short. Students lose the
    //              marks for the questions it never reaches.
    const system =
      "You are given TWO PDFs from a CA coaching portal: FIRST the QUESTION PAPER of a test, SECOND the document " +
      "attached to it as the OFFICIAL SOLUTION / answer key. Do not judge quality and do not award anything. " +
      "Report only what each document contains.\n" +
      "For the QUESTION PAPER list every question: its number, the marks printed for it, and a few words naming its " +
      "subject matter — include the company or person name where one is used (for example 'Misty Ltd interim results').\n" +
      "For the SOLUTION list every question it actually answers, in the same way.\n" +
      "Then, for each question in the PAPER, say whether the solution answers it: use the company/person names and " +
      "the figures to decide, not the question numbers, because the numbering often differs.\n" +
      "Respond ONLY as compact JSON, no prose, no code fences:\n" +
      '{"paper":[{"n":"Q1","marks":5,"about":"..."}],"key":[{"n":"Q1","about":"..."}],' +
      '"answered":[{"paper_q":"Q1","in_key":true,"why":"same Misty Ltd figures"}]}';

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: await fastModel(),
        max_tokens: 1500,
        temperature: 0,
        system,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(q).toString("base64") } },
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(sol).toString("base64") } },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[key_match] Anthropic refused", res.status, (await res.text()).slice(0, 200));
      return { verdict: "unclear", note: "the comparison could not be run" };
    }
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("key_match", await fastModel(), Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const raw = String(data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw) as {
      paper?: { n?: string; marks?: number; about?: string }[];
      key?: { n?: string; about?: string }[];
      answered?: { paper_q?: string; in_key?: boolean; why?: string }[];
    };

    const paper = parsed.paper ?? [];
    const key = parsed.key ?? [];
    const answered = parsed.answered ?? [];
    if (paper.length === 0 || key.length === 0) {
      return { verdict: "unclear", note: "the questions could not be read from one of the files" };
    }

    const missing = answered.filter((a) => a.in_key === false).map((a) => String(a.paper_q ?? "?"));
    const covered = answered.filter((a) => a.in_key === true).length;

    // The key answers MORE than this paper asks — the surplus belongs to
    // another paper. That is the wrong file, not a short one.
    const surplus = key.length - covered;

    if (covered === 0) {
      return {
        verdict: "mismatch",
        note: `The key answers none of this paper's ${paper.length} question(s). It appears to be the solution to a different test` +
          (key[0]?.about ? ` (it answers: ${key.map((k) => k.about).filter(Boolean).slice(0, 3).join("; ")})` : "") + ".",
      };
    }
    if (surplus > 0) {
      return {
        verdict: "mismatch",
        note: `The key answers ${surplus} question(s) this paper does not ask` +
          (missing.length ? `, and has no answer for ${missing.join(", ")}` : "") + ".",
      };
    }
    if (missing.length > 0) {
      return {
        verdict: "incomplete",
        note: `The key is for this paper but has no answer for ${missing.join(", ")} — a student who answers ${missing.length === 1 ? "it" : "those"} scores nothing for ${missing.length === 1 ? "it" : "them"}.`,
      };
    }
    return { verdict: "match", note: `All ${paper.length} question(s) are answered by the key.` };
  } catch (e) {
    console.error("[key_match] failed", e instanceof Error ? e.message : e);
    return { verdict: "unclear", note: "the comparison could not be run" };
  }
}

export async function classifySolutionPdf(pdfUrl: string): Promise<"typeset" | "handwritten" | "unreadable"> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !pdfUrl) return "unreadable";
  try {
    const res0 = await fetch(pdfUrl, { cache: "no-store" });
    if (!res0.ok) return "unreadable";
    const full = new Uint8Array(await res0.arrayBuffer());

    // Take page one only.
    let firstPage: Uint8Array = full;
    try {
      const { PDFDocument } = await import("pdf-lib");
      const src = await PDFDocument.load(full, { ignoreEncryption: true });
      if (src.getPageCount() === 0) return "unreadable";
      const out = await PDFDocument.create();
      const [p] = await out.copyPages(src, [0]);
      out.addPage(p);
      firstPage = await out.save();
    } catch {
      return "unreadable";
    }
    if (firstPage.byteLength > 12 * 1024 * 1024) return "unreadable";

    const system =
      "You are shown the first page of a document that is meant to be the OFFICIAL model answer for a CA exam paper. " +
      "Reply with ONE word and nothing else:\n" +
      "typeset - a properly typed and formatted document: printed text, tables, headings. A publisher's or " +
      "institute's suggested answers.\n" +
      "handwritten - a scan or photograph of handwriting: a student's answer book, a copy written by hand, " +
      "ruled answer-sheet paper, marks or ticks written on it.\n" +
      "unreadable - blank, corrupt, or impossible to tell.";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: await fastModel(),
        max_tokens: 8,
        system,
        messages: [{
          role: "user",
          content: [{
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: Buffer.from(firstPage).toString("base64") },
          }],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[solution_audit] Anthropic refused", res.status, (await res.text()).slice(0, 200));
      return "unreadable";
    }
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("solution_audit", await fastModel(), Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const word = String(data.content?.[0]?.text ?? "").toLowerCase();
    if (word.includes("handwritten")) return "handwritten";
    if (word.includes("typeset")) return "typeset";
    return "unreadable";
  } catch (e) {
    console.error("[solution_audit] failed", e instanceof Error ? e.message : e);
    return "unreadable";
  }
}

// Work out ONCE how a paper's marks break down, so every student's copy is
// marked against the same ladder — and so the whole official solution does not
// have to be sent to the model on every single submission.
// Has this answer book ALREADY been checked by somebody?
//
// Students hold copies marked under the old system, and a copy that comes back
// round would be marked a second time — the AI would see the previous
// examiner's ticks and totals and mark on top of them. Only the first two
// pages are read: marking shows up immediately if it is there.
export async function looksAlreadyChecked(pdfUrl: string): Promise<boolean> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !pdfUrl) return false;
  try {
    const res0 = await fetch(pdfUrl, { cache: "no-store" });
    if (!res0.ok) return false;
    const full = new Uint8Array(await res0.arrayBuffer());

    let head: Uint8Array = full;
    try {
      const { PDFDocument } = await import("pdf-lib");
      const src = await PDFDocument.load(full, { ignoreEncryption: true });
      const n = Math.min(2, src.getPageCount());
      if (n === 0) return false;
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, Array.from({ length: n }, (_, i) => i));
      for (const pg of pages) out.addPage(pg);
      head = await out.save();
    } catch {
      return false; // unreadable — let the normal marking path deal with it
    }
    if (head.byteLength > 12 * 1024 * 1024) return false;

    const system =
      "You are shown the first pages of a student's handwritten CA answer book. " +
      "Decide whether it has ALREADY BEEN MARKED by an examiner. Say checked ONLY if you can see UNMISTAKABLE " +
      "evidence of it: marks awarded against an answer (2/5, 6 marks), a total or grand total added by someone " +
      "else, an examiner's written remark, or a signature or stamp.\n" +
      "Ticks, crosses, underlining, circled question numbers, corrections and neat presentation are NOT enough " +
      "on their own — students tick and correct their own work constantly, and a page full of red pen may be " +
      "entirely the student's. A previous evaluation ALWAYS leaves marks or a total somewhere; if you cannot " +
      "see marks or a total, it has not been checked.\n" +
      "Reply with ONE word: checked or clean. If there is any doubt at all, reply clean.";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: await fastModel(),
        max_tokens: 8,
        temperature: 0,
        system,
        messages: [{
          role: "user",
          content: [{
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: Buffer.from(head).toString("base64") },
          }],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("already_checked", await fastModel(), Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    return String(data.content?.[0]?.text ?? "").toLowerCase().includes("checked");
  } catch (e) {
    console.error("[already_checked] failed", e instanceof Error ? e.message : e);
    return false; // never block a genuine submission because a check errored
  }
}

export async function buildMarkingScheme(input: {
  paperTitle: string;
  totalMarks?: number | null;
  solutionPdfUrl?: string | null;
  solutionText?: string | null;
}): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  if ((await aiDisabledSet()).has("grade_descriptive")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";

  const system =
    "You are CA Parveen Sharma's head examiner writing the MARKING SCHEME for one question paper. " +
    "You are given the official solution. Break the paper down so that any examiner marking any student's " +
    "answer book would award identical marks.\n" +
    "For EVERY question: the question number, the marks it carries, and then the individual steps that earn " +
    "those marks — each working note, each journal entry, each format or heading, each figure, each " +
    "conclusion — with the marks against each step. The step marks must add up exactly to the question's " +
    "marks, and the questions must add up to the paper's total.\n" +
    (input.totalMarks ? `The paper carries ${input.totalMarks} marks in total. ` : "") +
    // The scheme once solved the question its own way and reached different
    // figures from the approved key: the key had cash sales of Rs 1,00,600, the
    // scheme Rs 1,04,000. Students then read one document and were marked
    // against the other. The approved solution is the authority; this is a
    // breakdown of it, not a second attempt at the sum.
    "EVERY figure in the scheme MUST be taken from the official solution exactly as it appears there. " +
    "Do NOT re-work the question, do NOT recompute a total, and do NOT substitute a figure you would have " +
    "arrived at yourself — even if you believe the solution is wrong. If the solution's own arithmetic looks " +
    "wrong to you, still use ITS figure and add a line 'CHECK: <what looks wrong>' beneath that step so a " +
    "person can look at it. A scheme that disagrees with the approved solution is worse than no scheme.\n" +
    LIBERAL_MARKING +
    "Also state, in one line per question, what earns partial credit and what earns nothing, AND name any " +
    "alternative method that a student could validly use to reach the same answer, so that a student who takes " +
    "the other route is given the same marks.\n" +
    "Write it compactly as plain text — this is a working document an examiner reads, not prose. " +
    "No preamble, no markdown fences.";

  try {
    if (input.solutionPdfUrl) {
      const res0 = await fetch(input.solutionPdfUrl, { cache: "no-store" });
      if (!res0.ok) return null;
      const buf = await res0.arrayBuffer();
      if (buf.byteLength > 20 * 1024 * 1024) return null;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          temperature: 0,
          system,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: `Paper: ${input.paperTitle}\nWrite the marking scheme for this official solution.` },
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buf).toString("base64") } },
            ],
          }],
        }),
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("[marking_scheme] refused", res.status, (await res.text()).slice(0, 200));
        return null;
      }
      const data = await res.json();
      const u = data.usage ?? {};
      await logUsage("marking_scheme", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
      return String(data.content?.[0]?.text ?? "").trim() || null;
    }

    if (input.solutionText && input.solutionText.trim()) {
      return await callClaude(
        system,
        `Paper: ${input.paperTitle}\n\nOfficial solution:\n${input.solutionText.slice(0, 60000)}`,
        8000,
        { feature: "marking_scheme" },
      );
    }
    return null;
  } catch (e) {
    console.error("[marking_scheme] failed", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function gradeDescriptivePaper(
  studentPdfUrl: string,
  solutionPdfUrl: string,
  totalMarks?: number | null,
): Promise<DescriptiveGrade | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !studentPdfUrl || !solutionPdfUrl) return null;
  if ((await aiDisabledSet()).has("grade_descriptive")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const [stu, sol] = await Promise.all([
      fetch(studentPdfUrl, { cache: "no-store" }),
      fetch(solutionPdfUrl, { cache: "no-store" }),
    ]);
    if (!stu.ok || !sol.ok) {
      console.error("[grade_descriptive] cannot read PDFs", { student: stu.status, solution: sol.status });
      return null;
    }
    const [stuBuf, solBuf] = await Promise.all([stu.arrayBuffer(), sol.arrayBuffer()]);
    // Anthropic caps a request at 32 MB, and base64 inflates a file by a third.
    // Some answer keys here are already 24 MB, so a big scan plus a big key
    // would be refused outright — say so plainly instead of failing blank.
    if (stuBuf.byteLength + solBuf.byteLength > 22 * 1024 * 1024) {
      console.error("[grade_descriptive] too large to send", {
        studentMB: +(stuBuf.byteLength / 1048576).toFixed(1),
        solutionMB: +(solBuf.byteLength / 1048576).toFixed(1),
      });
      return null;
    }
    const [stuB64, solB64] = [Buffer.from(stuBuf).toString("base64"), Buffer.from(solBuf).toString("base64")];
    const sys =
      "You are CA Parveen Sharma's examiner checking a CA descriptive (subjective) answer paper. " +
      "You are given TWO PDFs: FIRST the STUDENT'S HANDWRITTEN answer book (read the handwriting carefully — it may be untidy or rotated), and SECOND the teacher's OFFICIAL SOLUTION / answer key. " +
      "Grade the student's answers against the official solution and standard ICAI marking conventions. The official solution shows ONE correct route. A student who reaches a correct result by a DIFFERENT but valid method under the applicable standard must be given the marks for it — apply your judgement and do not penalise a sound alternative treatment merely because the solution takes another route. Marks are for correct accounting, not for reproducing the solution's presentation. What you must not do is award marks for working that is actually wrong. Mark MECHANICALLY, not by overall impression: for each question take the marks printed for it, break them into the individual steps the official solution shows (each working note, each entry, each format, each conclusion), award the marks for every step the student has actually produced, and add them up. Partial marks for a partially-correct step. Do not round, do not adjust a total to feel right, and never let presentation change a mark the working has earned. Marking the same answer book twice MUST give the same result. " +
      (totalMarks
        ? `The paper is out of ${totalMarks} total marks; distribute marks across the questions sensibly. `
        : "Use the marks indicated for each question in the paper/solution. ") +
      "For EACH question: the marks awarded, the max marks, and a one-line comment. Then overall: improvement points (where marks were lost / what went wrong) and the specific concepts / accounting standards / sections the student got wrong and must revise. " +
      "If part of the handwriting is genuinely unreadable, grade what you can, set \"unreadable\":true, and say so — NEVER invent answers the student did not write. " +
      "ALSO return \"annotations\": marks to place directly on the STUDENT's pages. For each, give the 1-based page number of the student's answer book, an approximate vertical position y (0.0 = top of that page, 1.0 = bottom), a kind (\"right\" = correct step, \"wrong\" = mistake, \"partial\" = partly right, \"tip\" = improvement/concept), and a SHORT note (under 12 words — the concept, the mistake, or the fix). Aim for 1–4 annotations per page, placed near where each point occurs. " +
      "Respond ONLY as compact JSON, no prose, no code fences: " +
      '{"awarded":<number>,"total":<number>,"summary":"<one-line overall>","per_question":[{"q":"Q1","awarded":4,"max":6,"comment":"..."}],"improvements":["..."],"concepts_to_revise":["..."],"annotations":[{"page":1,"y":0.25,"kind":"wrong","note":"AS 13 cost excludes brokerage"}],"unreadable":false}.';
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        // An examiner must give the SAME paper the same marks. Left at the API
        // default, the model re-marked one answer book 9, then 13, then 12.
        temperature: 0,
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "STUDENT'S HANDWRITTEN ANSWER BOOK (grade this):" },
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: stuB64 } },
              { type: "text", text: "OFFICIAL SOLUTION / ANSWER KEY (grade against this):" },
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: solB64 } },
              { type: "text", text: "Grade the student's paper now and return the JSON." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      // Silence here is what hid the real bug for so long. A refused request
      // (payload over 32 MB, more than 100 pages, rate limit, bad key) must be
      // readable in the Vercel logs.
      console.error("[grade_descriptive] Anthropic refused", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("grade_descriptive", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    if (!text) {
      console.error("[grade_descriptive] the model returned no text at all");
      return null;
    }
    return parseDescriptiveGrade(text, totalMarks ?? null);
  } catch (e) {
    console.error("[grade_descriptive] marking failed", e instanceof Error ? e.message : e);
    return null;
  }
}

// Read the report object out of whatever the model actually sent.
//
// A single stray character used to cost the whole marking run: JSON.parse threw,
// the caller returned null, nothing was written, and the cron picked the same
// paper up five minutes later and paid for it again — for ever, in silence.
// So we try in order: the text as-is, the text with code fences stripped, and
// the outermost {...} in it (which survives a sentence of preamble). Control
// characters that the model sometimes leaves inside a string are escaped rather
// than allowed to break the parse.
function readGradeJson(raw: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const stripped = raw.replace(/```json|```/g, "").trim();
  candidates.push(stripped);
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(stripped.slice(first, last + 1));

  for (const c of candidates) {
    for (const attempt of [c, escapeControlCharsInStrings(c)]) {
      try {
        const j = JSON.parse(attempt);
        if (j && typeof j === "object") return j as Record<string, unknown>;
      } catch { /* try the next shape */ }
    }
  }
  return null;
}

// A literal newline or tab inside a JSON string is invalid, and models do emit
// them in long examiner comments. Escape them instead of losing the report.
function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && ch === "\n") { out += "\\n"; continue; }
    if (inString && ch === "\r") { out += "\\r"; continue; }
    if (inString && ch === "\t") { out += "\\t"; continue; }
    out += ch;
  }
  return out;
}

// Both graders (solution PDF, approved solution text) return the same report,
// so the shape is parsed in one place.
// How an answer key must be laid out on the page.
//
// The keys were coming back as markdown prose — "**Working Note 5**", a ledger
// written as a "Dr Side:" list followed by a "Cr Side:" list — and a student
// comparing that against their own answer book has nothing to compare. ICAI
// prints a two-sided account. So does this.
//
// Everything is rendered in a fixed-width font (screen, and Courier in the
// checked copy), which means columns aligned with spaces hold their shape. That
// is the only layout instrument available, and it is enough.
const ICAI_LAYOUT =
  "LAYOUT — present it exactly as ICAI prints its Suggested Answers, using SPACES to align columns. The output is " +
  "read in a fixed-width font, so spaces line up: never use markdown (no #, no **, no tables, no bullets) and never " +
  "use tab characters. " +
  "Every LEDGER ACCOUNT must be a two-sided account, not two lists: a centred title line 'Dr.' at the left and 'Cr.' " +
  "at the right, a header row 'Particulars' and 'Amount (Rs.)' on each side, entries paired across the page, a rule " +
  "of dashes above the totals, and the two totals level with each other on the same line. " +
  "Every STATEMENT, working note and computation is a labelled column of figures with the amounts right-aligned in " +
  "one column, a dashes rule before a total, and the total on its own line. " +
  "Keep every line within 96 characters so nothing wraps. Use 'Rs.' not the rupee symbol, Indian digit grouping " +
  "(1,25,000 not 125,000), and brackets for deductions. Head each answer 'ANSWER TO QUESTION n' on its own line and " +
  "each working 'Working Note n: <title>'. " +
  "The working must be COMPLETE and internally consistent: do not show a figure, then a contradiction, then a " +
  "'revised check' that lands somewhere else. If the question's data genuinely does not reconcile, say so once, in " +
  "one sentence, state the assumption you adopt, and carry that assumption through the rest of the answer. ";

// The house marking policy, set by CA Parveen Sharma: mark liberally, for
// every student, on every paper. It sits in one place so the grader and the
// marking-guide writer cannot drift apart on it.
//
// It is deliberately not a licence to award marks for wrong accounting — that
// would tell a student they are ready when they are not, which is the one
// outcome worse than a hard mark. It is a rule about DOUBT: where a step could
// be read either way, it is read in the student's favour.
const LIBERAL_MARKING =
  "MARKING POLICY — MARK LIBERALLY. This is a practice test set by the teacher, not the ICAI examination, and the " +
  "purpose is to keep the student working. Apply these throughout: " +
  "(a) where a step could reasonably be read either way, resolve it IN THE STUDENT'S FAVOUR and award the mark; " +
  "(b) award the step in full where the method and the treatment are right but the arithmetic slips, and carry that " +
  "wrong figure forward without punishing it again — a single error is charged ONCE, never at every later step that " +
  "depends on it; " +
  "(c) award the marks for a correct working note, entry, format or conclusion even where it is untidy, out of order, " +
  "abbreviated, or on a different page — presentation NEVER costs a mark; " +
  "(d) where the student's route differs from the solution but is valid under the standard, award it in full; " +
  "(e) where a step is partly right, lean to the higher part-mark rather than the lower; " +
  "(f) do not deduct for anything the guide does not list as earning marks. " +
  "The one thing you must NOT do is award marks for accounting that is actually wrong, or for a step the student " +
  "did not attempt — a mark for nothing tells a student they are ready when they are not. Say in the question's " +
  "comment where you have given the benefit of the doubt, so the examiner can see it. ";

// The shape of a marking report, as the API must return it. Declaring it as a
// tool and forcing the call is what makes the step-by-step award compulsory:
// asking for it in the prompt was ignored on the very first paper.
const MARKS_TOOL = {
  name: "submit_marks",
  description: "Return the marks for this answer book, step by step against the marking guide.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line on the paper overall." },
      per_question: {
        type: "array",
        description: "One entry per question in the marking guide, in its order.",
        items: {
          type: "object",
          properties: {
            q: { type: "string", description: "Question number as the guide writes it." },
            max: { type: "number", description: "Marks the question carries." },
            comment: { type: "string", description: "One line on this answer." },
            steps: {
              type: "array",
              description:
                "EVERY step the guide lists for this question, in its order — including steps the student left blank, with awarded 0.",
              items: {
                type: "object",
                properties: {
                  step: { type: "string", description: "The step label, exactly as the guide writes it." },
                  max: { type: "number", description: "Marks the guide allots this step." },
                  awarded: { type: "number", description: "What THIS student earned for this step alone." },
                },
                required: ["step", "max", "awarded"],
              },
            },
          },
          required: ["q", "max", "comment", "steps"],
        },
      },
      improvements: { type: "array", items: { type: "string" } },
      concepts_to_revise: { type: "array", items: { type: "string" } },
      annotations: {
        type: "array",
        description: "Marks to place on the student's pages, 1-4 per page.",
        items: {
          type: "object",
          properties: {
            page: { type: "number", description: "1-based page number." },
            y: { type: "number", description: "0.0 top to 1.0 bottom." },
            kind: { type: "string", enum: ["right", "wrong", "partial", "tip"] },
            note: { type: "string", description: "Under 12 words." },
          },
          required: ["page", "y", "kind", "note"],
        },
      },
      unreadable: { type: "boolean", description: "True only if the handwriting genuinely cannot be read." },
    },
    required: ["summary", "per_question", "annotations"],
  },
} as const;

function parseDescriptiveGrade(text: string, totalMarks: number | null): DescriptiveGrade | null {
  const parsed = readGradeJson(text);
  if (!parsed) {
    console.error("[grade_descriptive] report was not readable JSON; first 300 chars:", text.slice(0, 300));
    return null;
  }
  return shapeDescriptiveGrade(parsed, totalMarks);
}

function shapeDescriptiveGrade(parsed: Record<string, unknown>, totalMarks: number | null): DescriptiveGrade | null {
  try {
    const j = parsed as {
      per_question?: unknown; annotations?: unknown; awarded?: unknown; total?: unknown;
      summary?: unknown; improvements?: unknown; concepts_to_revise?: unknown; unreadable?: unknown;
    };
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
    // Add the marks up here. The marker names which step of the guide earned
    // what; the totals are arithmetic on those steps, never the marker's own
    // figure. That is what stops the same answer book scoring 9 one run and 13
    // the next — and it lets a student see exactly which step lost the mark.
    const pq = Array.isArray(j.per_question)
      ? j.per_question.map((p: { q?: unknown; awarded?: unknown; max?: unknown; comment?: unknown; steps?: unknown }) => {
          const steps = Array.isArray(p.steps)
            ? (p.steps as { step?: unknown; max?: unknown; awarded?: unknown }[])
                .map((s) => ({
                  step: String(s.step ?? "").trim(),
                  max: Math.max(0, Number(s.max) || 0),
                  awarded: Math.max(0, Number(s.awarded) || 0),
                }))
                .filter((s) => s.step)
                .map((s) => ({ ...s, awarded: s.max ? Math.min(s.awarded, s.max) : s.awarded }))
            : [];
          const max = Number(p.max) || steps.reduce((t, s) => t + s.max, 0);
          const awarded = steps.length
            ? Math.min(steps.reduce((t, s) => t + s.awarded, 0), max || Infinity)
            : Number(p.awarded) || 0;
          return {
            q: String(p.q ?? "").trim(),
            awarded: Math.round(awarded * 4) / 4, // CA marks move in quarters at finest
            max,
            comment: String(p.comment ?? "").trim(),
            steps,
          };
        })
      : [];
    const stepped = pq.some((p) => (p.steps?.length ?? 0) > 0);
    const validKinds = new Set(["right", "wrong", "partial", "tip"]);
    const annotations: PaperAnnotation[] = Array.isArray(j.annotations)
      ? j.annotations
          .map((a: { page?: unknown; y?: unknown; kind?: unknown; note?: unknown }) => ({
            page: Math.max(1, Math.round(Number(a.page) || 1)),
            y: Math.min(1, Math.max(0, Number(a.y) || 0)),
            kind: (validKinds.has(String(a.kind)) ? String(a.kind) : "tip") as PaperAnnotation["kind"],
            note: String(a.note ?? "").trim(),
          }))
          .filter((a: PaperAnnotation) => a.note)
      : [];
    return {
      awarded: stepped
        ? Math.round(pq.reduce((s: number, p: { awarded: number }) => s + p.awarded, 0) * 4) / 4
        : Number.isFinite(Number(j.awarded))
          ? Number(j.awarded)
          : pq.reduce((s: number, p: { awarded: number }) => s + p.awarded, 0),
      total: Number(j.total) || totalMarks || pq.reduce((s: number, p: { max: number }) => s + p.max, 0),
      summary: String(j.summary ?? "").trim(),
      per_question: pq,
      improvements: arr(j.improvements),
      concepts_to_revise: arr(j.concepts_to_revise),
      annotations,
      unreadable: Boolean(j.unreadable),
    };
  } catch (e) {
    console.error("[grade_descriptive] report JSON had an unexpected shape", e instanceof Error ? e.message : e);
    return null;
  }
}

// Read the "time allowed" and "maximum marks" printed on a question-paper PDF, so
// the teacher doesn't have to type them. Returns nulls for anything not clearly
// printed. One cheap call at upload time. Gated with the descriptive toggle.
export async function detectPaperMeta(questionPdfUrl: string): Promise<{ minutes: number | null; totalMarks: number | null } | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !questionPdfUrl) return null;
  if ((await aiDisabledSet()).has("grade_descriptive")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const r = await fetch(questionPdfUrl, { cache: "no-store" });
    if (!r.ok) return null;
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    const sys =
      "You are reading a CA exam/test question paper. Find the TIME ALLOWED and the MAXIMUM MARKS if printed on it (usually near the top). " +
      "Convert hours to minutes (e.g. '3 Hours' → 180; '1½ hours' → 90). If a value is not clearly printed, use null — do not guess. " +
      'Respond ONLY as compact JSON, no prose: {"minutes":<total minutes or null>,"total_marks":<maximum marks or null>}.';
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: "Extract the time allowed (in minutes) and the maximum marks." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      // Silence here is what hid the real bug for so long. A refused request
      // (payload over 32 MB, more than 100 pages, rate limit, bad key) must be
      // readable in the Vercel logs.
      console.error("[grade_descriptive] Anthropic refused", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("grade_descriptive", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
    if (!text) return null;
    const j = JSON.parse(text.replace(/```json|```/g, "").trim());
    const minutes = Number(j.minutes);
    const total = Number(j.total_marks);
    return { minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null, totalMarks: Number.isFinite(total) && total > 0 ? Math.round(total) : null };
  } catch {
    return null;
  }
}

// Class summary built STRICTLY from the uploaded transcript (no outside
// knowledge): what was discussed, the concepts, how many homework questions
// were solved in class, and the homework set for next class. One-time; shown to
// students.
export type ClassSummary = {
  summary: string;
  questions_discussed: string[];
  concepts_discussed: string[];
  homework_covered_count: number;
  homework_next: string;
};
export async function summarizeClass(transcript: string): Promise<ClassSummary | null> {
  if (!transcript.trim()) return null;
  const sys =
    "You summarise a CA class for students using ONLY the transcript provided — never add outside knowledge. " +
    "Cover ONLY the academic content — concepts, standards, sections, questions and homework. " +
    "NEVER mention dates, days of the week, festivals, holidays, greetings, small talk, attendance, " +
    "technical/audio issues, or any other noise; ignore all such chatter in the transcript. " +
    "Respond ONLY as compact JSON, no prose, no code fences: " +
    '{"summary":"<3-5 short bullet points of what this class covered — each bullet on its own line starting with \\"- \\"; NO paragraphs>",' +
    '"questions_discussed":["<question/problem discussed in class 1>","..."],' +
    '"concepts_discussed":["<concept/standard/section discussed 1>","..."],' +
    '"homework_covered_count":<how many homework/practice questions were SOLVED during the class>,' +
    '"homework_next":"<the homework given in this class for the next class, or empty string>"}.';
  const text = await callClaude(sys, `Transcript:\n${transcript.slice(0, 24000)}`, 1200, { feature: "summarize" });
  if (!text) return null;
  try {
    const j = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
    return {
      summary: String(j.summary ?? "").trim(),
      questions_discussed: arr(j.questions_discussed),
      concepts_discussed: arr(j.concepts_discussed),
      homework_covered_count: Number(j.homework_covered_count) || 0,
      homework_next: String(j.homework_next ?? "").trim(),
    };
  } catch {
    return null;
  }
}

// ---- Shared copy rules -------------------------------------------------------
// The founder's standing rule for everything this platform publishes: no
// advertising voice, anywhere. A post has to be worth reading on its own — a
// concept cleared, a habit, an honest question — and the site is named only
// now and then, in one plain line, the way a teacher mentions where something
// is kept. A reader should never feel they are being marketed to.
// NOT TAUGHT HERE.
//
// Founder's instruction: partnership accounts are not part of any course on
// this platform, so nothing — no post, no article, no question, no example —
// should ever be built on them. Applied to every prompt that writes teaching
// content rather than being remembered in one place and forgotten in the rest.
export const NOT_TAUGHT =
  " SYLLABUS LIMIT: partnership accounting is NOT taught here — never write a post, article, question, example or explanation about partnership accounts (admission, retirement or death of a partner, revaluation of a firm, dissolution of a partnership, partners' capital or current accounts). If a source is about partnership accounting, say nothing about it. ";

export const SOFT_RULES =
  "You ghost-write for CA Parveen Sharma, who has taught Indian CA students (Foundation/Intermediate/Final) for 36 years. Write in his voice: first person, warm, plain English, an experienced teacher talking to students he knows. " +
  // His name is searched for far more often with an r — "Praveen" — than
  // without. Writing it out once, in a natural sentence, lets a student who
  // spells it that way find the article. ONCE: repeating it would read as
  // keyword stuffing and Google treats it as such.
  "If you name him in the article, write it once as \"CA Parveen Sharma (also written Praveen Sharma)\" and use the plain form everywhere else. Never repeat that parenthesis more than once in a piece. " +
  "THIS IS NOT ADVERTISING. Never write 'enroll', 'join now', 'sign up', 'register', 'don't miss', 'limited', 'hurry', 'best coaching', 'India's leading', 'check out our', 'DM us', 'link in bio', 'offer', 'discount' — or any other call to action. No urgency, no superlatives, no ALL-CAPS words, no strings of exclamation marks, no emoji walls (one emoji at most, and none where the channel brief says none). Never open with a sales hook. " +
  "Every piece must be worth reading for a student who will never buy anything: it teaches one thing, corrects one mistake, asks one honest question, or says one true thing about studying. Substance first, always. " +
  "NEVER invent facts, numbers, pass percentages, dates, deadlines, fees, discounts, student stories or testimonials. General observations from years of teaching are fine; specific anecdotes are not. If an exam rule may have changed, say it should be checked in the latest ICAI material instead of stating it. " +
  "The only claims you may make about the platform: CA Parveen Sharma has 36 years of teaching experience; the site has a free day-by-day study planner, free chapter MCQ tests with a concept-wise report, case-scenario practice for the new exam pattern, recorded classes, live classes, free articles, and doubt-solving help. " +
  NOT_TAUGHT;


// "Couldn't generate the pack — check the Anthropic key" was shown for every
// possible cause, including the ones that had nothing to do with the key. The
// real reason is now recorded with a piece of what the model actually said,
// and the Campaigns page shows it.
async function notePackFailure(reason: string, raw: string): Promise<null> {
  try {
    await createServiceClient().from("site_settings").upsert({
      key: "pack_last_error",
      value: JSON.stringify({ at: new Date().toISOString(), reason, sample: raw.slice(0, 400) }),
    }, { onConflict: "key" });
  } catch { /* a diagnostic must never be the thing that breaks */ }
  return null;
}

async function notePackOk(): Promise<void> {
  try {
    await createServiceClient().from("site_settings").upsert(
      { key: "pack_last_error", value: "" }, { onConflict: "key" });
  } catch { /* ignore */ }
}

// ---- Is this news a CA student would care about? -----------------------------
// Requiring the keyword to be present stopped municipal appointments getting
// in, but not ordinary business news: "SEBI" appears in a company's quarterly
// filing story, "NCLT" in any corporate dispute. Those are general news. This
// keeps only what a CA student or a teacher of CA students would actually use —
// what the regulators DID, what changed in the rules, what an enforcement
// action teaches. Cheap model, one call per run; if it is unavailable nothing
// is filtered, because a feed that silently empties is worse than a noisy one.
const RELEVANCE_SYSTEM =
  "You screen news headlines for a Chartered Accountancy teaching platform in India. " +
  "KEEP a headline only if it is about the profession itself: a regulator's rule, circular, notification, standard, exposure draft, guidance or framework (ICAI, NFRA, MCA, RBI, SEBI, IASB, IFRS); an enforcement or disciplinary action, penalty, audit failure, fraud investigation or NCLT/insolvency ruling that teaches something about accounting, auditing or corporate law; a change to the CA course, exams or the profession's structure; or an accounting/auditing controversy of national significance. " +
  "DROP anything that is ordinary business news even when a regulator is named in it: company results, earnings, share prices, fundraising, appointments, board changes, product launches, deals, routine filings, market commentary, politics, and anything about one company's fortunes rather than the rules everyone works under. " +
  "When in doubt, DROP — his feed being short is not a problem; his feed being full of general news is. " +
  'Respond ONLY as compact JSON: {"keep":[0,3,7]} listing the indexes of the headlines to keep, and nothing else.';

export async function keepRelevantHeadlines(titles: string[]): Promise<number[] | null> {
  if (!titles.length) return [];
  const user = titles.map((t, i) => `${i}. ${t}`).join("\n");
  const text = await callClaude(RELEVANCE_SYSTEM, user, 700, { model: await fastModel(), feature: "feed" });
  if (!text) return null; // AI off or failed — caller keeps everything
  const json = parseLooseJson(text);
  const keep = Array.isArray(json?.keep) ? json.keep : null;
  if (!keep) return null;
  return keep.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < titles.length);
}

// ---- A campaign built from one chosen thing ----------------------------------
// The founder picks the reason first — this festival, this news item, this
// event — and the copy is written about that and nothing else. Before this,
// the whole news feed was fed to the writer as background and it dipped into
// seventy headlines at random, which is exactly what he could not stand.
// "own" never reaches the writer at all — his words go out exactly as typed.
export type SoftDay = { focus: string; posts: Record<string, string> };

export type SourceKind = "greeting" | "news" | "event" | "idea" | "article" | "own";

const KIND_RULES: Record<SourceKind, string> = {
  own: "", // never used — his own words are not written by anyone
  article:
    "This is an ARTICLE already published on the site. Do not summarise it end to end. Take the single most useful idea in it, teach that much properly so the post stands on its own, and let the article be there for anyone who wants the rest — mentioned once, plainly, at the end.",
  greeting:
    "This is a GREETING and only a greeting. Wish the reader warmly and stop. No teaching, no study advice, no mention of the platform, no link, no call to action of any kind. Two or three sentences at most on every channel.",
  news:
    "This is a NEWS ITEM the founder chose. Your job is to tell a CA student what it means for them — what changes, what to read up on, what to keep an eye on. HARD LIMIT: everything you state as fact must come from the source text below. Do not add a figure, a date, an outcome, a section number or a consequence that is not written there; where something is unclear, say it is worth reading the notification itself. Never take a side, never speculate about guilt or blame, never call it breaking news.",
  event:
    "This is an EVENT the founder chose. State plainly what it is, when it is, and who it is for, in his own warm voice. No hype, no urgency, no 'limited seats', no exclamation marks. Everything factual must come from the details below.",
  idea:
    "This is a TEACHING IDEA the founder chose. Explain it properly and simply, the way he would to a student sitting in front of him.",
};

export async function generateSourcedCampaign(input: {
  kind: SourceKind;
  title: string;
  detail: string;             // stored body + whatever he added himself
  url?: string | null;
  audience?: string | null;   // which students this is for
  channels: { key: string; label: string; brief: string; maxChars: number }[];
  scenario: string;
  mention: string | null;     // the one quiet product line, or null for none
}): Promise<SoftDay | null> {
  if (!input.channels.length) return null;
  const system =
    SOFT_RULES + BRIEF_RULES +
    "You are given ONE thing to write about and the places it has to be said. Write each piece from scratch in that platform's own voice — never paste the same sentences into two channels. Respect each channel's character limit. " +
    "Your entire reply is one JSON object and nothing else — no preamble, no explanation, no code fences. " +
    'Respond ONLY as compact JSON: {"focus":"5-8 words naming what this is","posts":{"<channel key>":"<the text>"}}';
  const mentionRule = input.mention
    ? `ONE of the pieces (whichever it sits most naturally in, and never the Reddit one) may carry a single quiet sentence mentioning ${input.mention} — placed at the end, phrased as something that exists and is there if it helps, never as an offer and never with a call to action. Every other piece mentions nothing at all.`
    : "No piece mentions the platform, any course or any link.";
  const user =
    `THE SITUATION RIGHT NOW — read this before writing a word:\n${input.scenario}\n\n` +
    `WHAT THIS CAMPAIGN IS ABOUT:\n${KIND_RULES[input.kind]}\n\n` +
    (input.audience ? `WHO IT IS FOR — write to these students and nobody else:\n${input.audience}\n\n` : "") +
    `Title: ${input.title}\n` +
    (input.url ? `Source link (for your understanding only — include it only if it genuinely helps the reader): ${input.url}\n` : "") +
    `Details, and everything you are allowed to treat as fact:\n${input.detail || "(nothing beyond the title — stay at that level and do not invent detail)"}\n\n` +
    `${mentionRule}\n\n` +
    `Write one piece for each channel below:\n\n` +
    input.channels.map((c) => `CHANNEL "${c.key}" — ${c.label} (max ${c.maxChars} characters)\n${c.brief}`).join("\n\n");
  const budget = input.channels.reduce((n, c) => n + c.maxChars, 0);
  const text = await callClaude(system, user, Math.min(700 + Math.ceil(budget / 2), 5000), { feature: "marketing" });
  if (!text) return await notePackFailure("the AI call itself failed — no key, a disabled toggle, or the API refused", "");
  const json = parseLooseJson(text);
  const raw = json?.posts;
  if (!raw || typeof raw !== "object") return await notePackFailure("the AI reply was not readable as JSON", text);
  const posts: Record<string, string> = {};
  for (const c of input.channels) {
    const v = String((raw as Record<string, unknown>)[c.key] ?? "").trim();
    if (v) posts[c.key] = v;
  }
  if (!Object.keys(posts).length) return await notePackFailure("the AI replied but wrote nothing for the chosen channels", text);
  await notePackOk();
  return { focus: String(json?.focus ?? "").trim() || input.title.slice(0, 60), posts };
}

// ---- SEO articles ------------------------------------------------------------
// Original educational articles for the public /articles section. Hard rules:
// never copy from any source, never invent statistics/dates/thresholds — where
// a rule may change, the article says "verify with the latest ICAI material".
export type WrittenArticle = { title: string; description: string; body_md: string };

const ARTICLE_SYSTEM =
  "You write ORIGINAL educational articles for caparveensharma.com, the CA coaching platform of CA Parveen Sharma (36 years of teaching experience). Audience: Indian CA students (Foundation/Intermediate/Final). " +
  "ABSOLUTE RULES: write 100% original prose — never reproduce text from ICAI materials, textbooks or websites. Never invent statistics, dates, fee amounts, section numbers or thresholds you are not certain of; where a rule/limit may have changed, write 'verify in the latest ICAI study material / announcement'. No fake testimonials or invented stories. " +
  "STYLE: a warm senior-teacher voice; simple English; short paragraphs; concrete worked LOGIC (not copied questions); markdown with ## and ### headings and bullet lists; 700–1000 words; end with a short '## FAQs' section (2–3 Q&As), then a final paragraph naturally pointing students to the free tools: the free day-by-day study planner at https://caparveensharma.com/free-planner?src=article and free case-scenario practice at https://caparveensharma.com (courses). " +
  "SEO: title ≤ 65 characters containing the main keyword; meta description ≤ 155 characters. " +
  NOT_TAUGHT +
  'Respond ONLY as compact JSON, no prose, no code fences: {"title":"...","description":"...","body_md":"..."}';

export async function writeArticle(topic: string, keywords: string): Promise<WrittenArticle | null> {
  const user = `Article topic: ${topic}\nTarget keywords: ${keywords}\nWrite the article now.`;
  const text = await callClaude(ARTICLE_SYSTEM, user, 3200, { feature: "articles" });
  if (!text) return null;
  const json = parseLooseJson(text);
  const title = String(json?.title ?? "").trim();
  const body = String(json?.body_md ?? "").trim();
  if (!title || body.length < 400) return null;
  return { title, description: String(json?.description ?? "").trim(), body_md: body };
}

// Weekly trend scan → new article topics. Input: fresh headlines from the
// accounting world (Ind AS/ICAI/NFRA/SEBI/SFIO/forensic/scams). Output: NEW
// topics for the article queue, angled educationally for CA students, never
// duplicating what's already queued or written.
export type TrendTopic = { topic: string; category: string; keywords: string };

const TRENDS_SYSTEM =
  "You pick article topics for a CA-student education site (caparveensharma.com). From the news headlines given, propose up to 8 NEW article topics. " +
  "RULES: every topic must be from the ACCOUNTING world (accounting standards, ICAI, NFRA, SEBI accounting/audit matters, SFIO/CBI fraud investigations, forensic accounting, corporate accounting scams, industry accounting news). " +
  "Angle each topic educationally for CA students — 'what happened and what a CA student should learn from it' — not as journalism. " +
  "Do NOT duplicate or closely repeat any topic from the EXISTING list. Do not assume facts beyond the headline itself; the article writer will phrase uncertain details carefully. " +
  "Include the source headline inside keywords so the writer has context. category must be one of: fr | advanced-accounting | strategy | career | news (use 'news' for scams/NFRA/SEBI/forensic/current-affairs topics). " +
  NOT_TAUGHT +
  'Respond ONLY as compact JSON: {"topics":[{"topic":"...","category":"news","keywords":"... | headline: ..."}]}';

// Evergreen topic brainstorm — keeps the article queue from EVER running dry
// (it emptied on 20 Jul and no articles were written for days). No headlines
// needed: study-guide topics for CA students, never repeating existing ones.
const EVERGREEN_SYSTEM =
  "You pick article topics for a CA-student education site (caparveensharma.com) run by CA Parveen Sharma (Financial Reporting for CA Final, Advanced Accounting for CA Inter). " +
  "Propose up to 15 NEW evergreen article topics students actually search for. " +
  // AT LEAST TWELVE OF FIFTEEN MUST BE THE SUBJECTS HE TEACHES.
  //
  // This prompt used to list "career paths after CA, articleship" among its
  // suggestions, and the machine obliged: of 195 articles published, 119 were
  // about something he does not teach. They do bring CA students — the
  // scholarship and articleship-transfer pieces were the most-read on the site
  // — but they bring students who will never buy Financial Reporting or
  // Advanced Accounting, and they clicked at 1.4% against the homepage's 18%.
  // The one article on his own subject, AS 13, out-drew every other page bar
  // the homepage. So the balance is now written into the instruction rather
  // than left to chance.
  "AT LEAST 12 of the 15 must be squarely on HIS OWN SUBJECTS — specific Ind AS / AS explainers, " +
  "tricky treatments (EIR, deferred tax, consolidation steps, cum-interest vs ex-interest, ESOP, leases), " +
  "worked problems, and the mistakes students actually make in them. " +
  "At most 3 may be exam strategy, revision planning or answer-writing, and ONLY where tied to those two subjects. " +
  "Do NOT propose articleship, dummy articleship, scholarships, stipends, firm reviews, salary or career-path topics at all — " +
  "they draw readers who will never take these classes. " +
  "Each topic must be concrete and searchable (not generic like 'how to study'). Do NOT duplicate or closely repeat any EXISTING topic. " +
  "category must be one of: fr | advanced-accounting | strategy | career | news. " +
  NOT_TAUGHT +
  'Respond ONLY as compact JSON: {"topics":[{"topic":"...","category":"fr","keywords":"comma, separated, keywords"}]}';

export async function proposeEvergreenTopics(existing: string[]): Promise<TrendTopic[] | null> {
  const user = `EXISTING topics (do not repeat any of these):\n${existing.slice(0, 250).map((t) => `- ${t}`).join("\n")}`;
  const text = await callClaude(EVERGREEN_SYSTEM, user, 2000, { feature: "articles" });
  if (!text) return null;
  const json = parseLooseJson(text);
  const arr = Array.isArray(json?.topics) ? json.topics : null;
  if (!arr) return null;
  const CATS = ["fr", "advanced-accounting", "strategy", "career", "news"];
  return arr
    .map((t: { topic?: unknown; category?: unknown; keywords?: unknown }) => ({
      topic: String(t.topic ?? "").trim(),
      category: CATS.includes(String(t.category)) ? String(t.category) : "strategy",
      keywords: String(t.keywords ?? "").trim(),
    }))
    .filter((t: TrendTopic) => t.topic.length > 15)
    .slice(0, 15);
}

export async function proposeTrendingTopics(headlines: string[], existing: string[]): Promise<TrendTopic[] | null> {
  const user =
    `FRESH HEADLINES (this week):\n${headlines.slice(0, 60).map((h) => `- ${h}`).join("\n")}\n\n` +
    `EXISTING topics (do not repeat):\n${existing.slice(0, 150).map((t) => `- ${t}`).join("\n")}`;
  const text = await callClaude(TRENDS_SYSTEM, user, 1800, { feature: "articles" });
  if (!text) return null;
  const json = parseLooseJson(text);
  const arr = Array.isArray(json?.topics) ? json.topics : null;
  if (!arr) return null;
  const CATS = ["fr", "advanced-accounting", "strategy", "career", "news"];
  return arr
    .map((t: { topic?: unknown; category?: unknown; keywords?: unknown }) => ({
      topic: String(t.topic ?? "").trim(),
      category: CATS.includes(String(t.category)) ? String(t.category) : "news",
      keywords: String(t.keywords ?? "").trim(),
    }))
    .filter((t: TrendTopic) => t.topic.length > 15)
    .slice(0, 8);
}

// Same examiner, but the answer key is APPROVED TEXT rather than a PDF — used
// for the papers that never had a suggested-answers file, once the founder has
// approved the drafted key.

// MARGIN NOTES, ASKED FOR ON THEIR OWN WHEN THE MARKING DID NOT SPARE THEM.
//
// The marking call returns marks AND the notes to write on the student's pages,
// and on a big paper it quite reasonably spends its reply on the marks: mock
// paper 1 marked 26 questions at 69/100 and returned not one annotation. The
// checked copy then has a margin and nothing in it — which is what a student
// notices first, because ticks beside their own working is the part that reads
// like marking rather than a score.
//
// So they are asked for separately, with the marks already decided and passed
// in. A small call, and it cannot disturb a mark: it returns notes only.
const NOTES_TOOL = {
  name: "submit_notes",
  description: "Return short notes to write in the margins of the student's answer pages.",
  input_schema: {
    type: "object",
    properties: {
      annotations: {
        type: "array",
        description: "1-4 per page, spread across the pages that have writing on them.",
        items: {
          type: "object",
          properties: {
            page: { type: "integer", description: "1-based page of the student's answer book." },
            y: { type: "number", description: "Vertical position, 0.0 top to 1.0 bottom." },
            kind: { type: "string", enum: ["right", "wrong", "partial", "tip"] },
            note: { type: "string", description: "Under 12 words." },
          },
          required: ["page", "y", "kind", "note"],
        },
      },
    },
    required: ["annotations"],
  },
} as const;

export async function marginNotesForPaper(
  studentPdfB64: string,
  grade: { summary?: string; per_question?: { q: string; awarded: number; max: number; comment?: string }[] },
): Promise<PaperAnnotation[]> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return [];
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  const marks = (grade.per_question ?? [])
    .map((q) => `${q.q}: ${q.awarded}/${q.max}${q.comment ? ` — ${q.comment}` : ""}`)
    .join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        temperature: 0,
        system:
          "You are placing an examiner's margin notes on a student's handwritten answer book. " +
          "The marks are ALREADY DECIDED and given to you — do not re-mark, do not argue with them, and do not " +
          "change a figure. Read the pages, and for each page with writing on it place 1 to 4 short notes where " +
          "the student would look: a tick where a step earned its mark, a cross where it lost one, a partial where " +
          "some credit was given, a tip where a better presentation would have helped. Under 12 words each.",
        tools: [NOTES_TOOL],
        tool_choice: { type: "tool", name: "submit_notes" },
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: studentPdfB64 } },
            { type: "text", text: `THE MARKS ALREADY AWARDED:\n${marks}\n\n${grade.summary ?? ""}` },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("grade_descriptive", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    if (data.stop_reason === "max_tokens") return [];
    const call = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "submit_notes",
    ) as { input?: { annotations?: unknown } } | undefined;
    const raw = Array.isArray(call?.input?.annotations) ? call!.input!.annotations as unknown[] : [];
    const validKinds = new Set(["right", "wrong", "partial", "tip"]);
    return raw
      .map((a) => {
        const x = a as { page?: unknown; y?: unknown; kind?: unknown; note?: unknown };
        return {
          page: Math.max(1, Math.round(Number(x.page) || 1)),
          y: Math.min(1, Math.max(0, Number(x.y) || 0)),
          kind: (validKinds.has(String(x.kind)) ? String(x.kind) : "tip") as PaperAnnotation["kind"],
          note: String(x.note ?? "").trim(),
        };
      })
      .filter((a) => a.note);
  } catch {
    return [];
  }
}

export async function gradeDescriptivePaperAgainstText(
  studentPdfUrl: string,
  solutionText: string,
  totalMarks?: number | null,
): Promise<DescriptiveGrade | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !studentPdfUrl || !solutionText.trim()) return null;
  if ((await aiDisabledSet()).has("grade_descriptive")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const stu = await fetch(studentPdfUrl, { cache: "no-store" });
    if (!stu.ok) return null;
    const stuB64 = Buffer.from(await stu.arrayBuffer()).toString("base64");
    const sys =
      "You are CA Parveen Sharma's examiner checking a CA descriptive (subjective) answer paper. " +
      "You are given the STUDENT'S HANDWRITTEN answer book as a PDF, and the teacher's OFFICIAL APPROVED SOLUTION as text below. " +
      "Grade against that solution and standard ICAI marking conventions. The official solution shows ONE correct route. A student who reaches a correct result by a DIFFERENT but valid method under the applicable standard must be given the marks for it — apply your judgement and do not penalise a sound alternative treatment merely because the solution takes another route. Marks are for correct accounting, not for reproducing the solution's presentation. What you must not do is award marks for working that is actually wrong. Mark MECHANICALLY, not by overall impression: for each question take the marks printed for it, break them into the individual steps the official solution shows (each working note, each entry, each format, each conclusion), award the marks for every step the student has actually produced, and add them up. Partial marks for a partially-correct step. Do not round, do not adjust a total to feel right, and never let presentation change a mark the working has earned. Marking the same answer book twice MUST give the same result. " +
      (totalMarks
        ? `The paper is out of ${totalMarks} total marks; distribute marks across the questions sensibly. `
        : "Use the marks indicated for each question in the solution. ") +
      "For EACH question: marks awarded, max marks, and a one-line comment. Then overall: improvement points and the concepts / accounting standards / sections to revise. " +
      "If part of the handwriting is genuinely unreadable, grade what you can, set \"unreadable\":true, and say so — NEVER invent answers the student did not write. " +
      "ALSO return \"annotations\" to place on the student's pages: 1-based page number, vertical position y (0.0 top to 1.0 bottom), kind (\"right\"/\"wrong\"/\"partial\"/\"tip\") and a note under 12 words. Aim for 1-4 per page. " +
      // The same paper came back 9, then 13, then 12. A single per-question
      // number is a judgement made afresh every time. Naming the step and its
      // award turns marking into bookkeeping: the steps come from the guide,
      // and the totals are added up here rather than by the marker.
      "For EVERY question you MUST also return \"steps\": one entry for EACH step listed for that question in the marking guide, copied in the guide's own order, with its \"step\" label exactly as the guide writes it, its \"max\" as the guide allots, and \"awarded\" being what this student earned for that step alone (0, the full amount, or a part of it). Do not merge steps, do not omit a step the student left blank — return it with awarded 0. Do not adjust any step to make a total look right; the totals are calculated from the steps, not from you. " +
      // CA Parveen Sharma's stated policy, for every student: mark liberally.
      // These are learning tests, not the ICAI examination — a mark taken away
      // for a slip the student already understands teaches nothing, and a
      // student who is marked harshly here stops sitting the tests at all.
      LIBERAL_MARKING +
      "Respond ONLY as compact JSON, no prose, no code fences: " +
      '{"awarded":<number>,"total":<number>,"summary":"<one-line overall>","per_question":[{"q":"Q1","awarded":4,"max":6,"comment":"...","steps":[{"step":"WN1: Invoice Price relationship stated","max":0.5,"awarded":0.5}]}],"improvements":["..."],"concepts_to_revise":["..."],"annotations":[{"page":1,"y":0.25,"kind":"wrong","note":"AS 13 cost excludes brokerage"}],"unreadable":false}.';
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        // ROOM ENOUGH FOR THE SIZE OF THE PAPER.
        //
        // 8000 was set for a ten-question chapter test and is right for one:
        // Arnav's 20-mark papers finish in about 3,100 tokens. A 100-mark mock
        // with a step-by-step award on every question does not fit, and the
        // failure is silent and nasty — the tool call is cut off mid-JSON, a
        // partial object comes back carrying the summary and an EMPTY
        // per_question, and the marks add up to nothing. Mock paper 1 came back
        // at exactly 8,000 output tokens twice, and scored a good paper 0/100.
        //
        // So the ceiling follows the marks: roughly 250 tokens per mark, which
        // matches what the 20-mark papers actually use, with a floor of 8,000
        // and a cap well inside the model's limit.
        max_tokens: Math.min(24000, Math.max(8000, Math.round((totalMarks || 20) * 250))),
        // An examiner must give the SAME paper the same marks. Left at the API
        // default, the model re-marked one answer book 9, then 13, then 12.
        temperature: 0,
        system: sys,
        // Asking for the steps in the prompt was not enough — the first paper
        // marked under the new instruction came back without a single one. A
        // forced tool call makes the shape a requirement of the API rather than
        // a request: the marks cannot be returned without their steps, and the
        // reply arrives as an object, so there is no JSON to mis-parse either.
        tools: [MARKS_TOOL],
        tool_choice: { type: "tool", name: "submit_marks" },
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: stuB64 } },
            { type: "text", text: `OFFICIAL APPROVED SOLUTION:\n${solutionText.slice(0, 60000)}` },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      // Silence here is what hid the real bug for so long. A refused request
      // (payload over 32 MB, more than 100 pages, rate limit, bad key) must be
      // readable in the Vercel logs.
      console.error("[grade_descriptive] Anthropic refused", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("grade_descriptive", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);

    // RAN OUT OF ROOM = NO RESULT, NOT A PARTIAL ONE.
    //
    // When the reply is cut short the tool call still arrives, just unfinished,
    // and it parses into something that looks like a report and is not one.
    // That is how a good paper was recorded as zero. Refusing here sends it
    // back to the queue and then to an examiner, which is the honest outcome.
    if (data.stop_reason === "max_tokens") {
      console.error("[grade_descriptive] the marking was cut off at the token limit — not using a partial result", {
        totalMarks, output: u.output_tokens,
      });
      return null;
    }

    // The forced tool call returns the report as an object. Falling back to
    // text keeps this working if the model ever answers the old way.
    const call = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "submit_marks",
    ) as { input?: unknown } | undefined;
    if (call?.input && typeof call.input === "object") {
      return shapeDescriptiveGrade(call.input as Record<string, unknown>, totalMarks ?? null);
    }

    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    if (!text) {
      console.error("[grade_descriptive/text] the model returned neither marks nor text");
      return null;
    }
    return parseDescriptiveGrade(text, totalMarks ?? null);
  } catch (e) {
    console.error("[grade_descriptive/text] marking failed", e instanceof Error ? e.message : e);
    return null;
  }
}
