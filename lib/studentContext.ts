import { createServiceClient } from "@/lib/supabase/service";

// WHO is asking, before answering them.
//
// Naitik wrote asking whether the site is free for him or whether he still
// needs the ₹11,500 course he had already bought. The AI answered by listing
// what the portal can do — a true answer to a question nobody asked — because
// it had never been told anything about him. It could not have done better: it
// had the study material and the words of the question, and nothing else.
//
// A question about ACCESS, MONEY or "is this free for me" cannot be answered
// from teaching material at any quality of writing. It is answered from this
// student's own record, or it is handed to a person. Never guessed.

export type StudentFacts = {
  known: boolean;
  name: string | null;
  email: string;
  /** Plain-English lines a model can quote back without inventing anything. */
  lines: string[];
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "no end date";

export async function studentFacts(email: string): Promise<StudentFacts> {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr.includes("@")) return { known: false, name: null, email: addr, lines: [] };
  const svc = createServiceClient();
  const { data } = await svc
    .from("profiles")
    .select("id, full_name, email, study_level, created_at")
    .ilike("email", addr)
    .maybeSingle();
  return factsFor(data, addr, "This email does NOT have an account on the site.");
}

/**
 * The same record, found by the number they messaged from.
 *
 * WhatsApp never tells us an email, so every reply on that channel was written
 * without knowing whether the person had ever paid for anything. A student who
 * could not find the case studies was told where case studies live; the true
 * answer was that his account had no plan on it at all.
 */
export async function studentFactsByPhone(phone: string): Promise<StudentFacts> {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return { known: false, name: null, email: "", lines: [] };
  const svc = createServiceClient();
  const { data } = await svc
    .from("profiles")
    .select("id, full_name, email, study_level, created_at")
    .ilike("phone", `%${digits}`)
    .limit(1)
    .maybeSingle();
  return factsFor(data, "", "This number is NOT registered on the site.");
}

/** By account id — the website's own doubt box knows exactly who asked. */
export async function studentFactsById(userId: string): Promise<StudentFacts> {
  if (!userId) return { known: false, name: null, email: "", lines: [] };
  const svc = createServiceClient();
  const { data } = await svc
    .from("profiles")
    .select("id, full_name, email, study_level, created_at")
    .eq("id", userId)
    .maybeSingle();
  return factsFor(data, "", "This account could not be read.");
}

/** By Telegram chat — the bot knows the chat, the profile knows the person. */
export async function studentFactsByTelegram(chatId: string): Promise<StudentFacts> {
  if (!chatId) return { known: false, name: null, email: "", lines: [] };
  const svc = createServiceClient();
  const { data } = await svc
    .from("profiles")
    .select("id, full_name, email, study_level, created_at")
    .eq("telegram_chat_id", String(chatId))
    .maybeSingle();
  return factsFor(data, "", "This Telegram account is not linked to a student here.");
}

type Profile = { id: string; full_name: string | null; email: string | null; study_level: string | null } | null;

async function factsFor(profile: Profile, addr: string, whenUnknown: string): Promise<StudentFacts> {
  const out: StudentFacts = { known: false, name: null, email: addr, lines: [] };

  try {
    const svc = createServiceClient();
    if (!profile?.id) {
      out.lines.push(whenUnknown);
      return out;
    }
    out.email = addr || (profile.email ?? "");

    out.known = true;
    out.name = (profile.full_name as string) ?? null;
    out.lines.push(`They have an account${out.name ? ` in the name ${out.name}` : ""}.`);
    if (profile.study_level) out.lines.push(`They are preparing for ${profile.study_level}.`);

    const { data: subs } = await svc
      .from("subscriptions")
      .select("status, starts_at, ends_at, plans(tier, name), subjects(title)")
      .eq("student_id", profile.id as string)
      .order("ends_at", { ascending: false })
      .limit(20);

    const now = Date.now();
    const live = (subs ?? []).filter(
      (s) => s.status === "active" && (!s.ends_at || new Date(s.ends_at as string).getTime() > now),
    );

    if (live.length === 0) {
      out.lines.push("They have NO paid plan running right now.");
    } else {
      out.lines.push(`They have ${live.length} plan${live.length === 1 ? "" : "s"} running right now:`);
      for (const s of live) {
        const tier = (s.plans as { tier?: string; name?: string } | null)?.name
          ?? (s.plans as { tier?: string } | null)?.tier
          ?? "plan";
        const subject = (s.subjects as { title?: string } | null)?.title ?? "a subject";
        out.lines.push(`  · ${subject} — ${tier}, valid until ${fmt(s.ends_at as string | null)}.`);
      }
    }
    return out;
  } catch {
    // Knowing nothing is safe — the caller hands the question to a person.
    return out;
  }
}

/** True when the question is about access, money or their own account. */
export function isAccountQuestion(text: string): boolean {
  const t = text ?? "";
  const money = /\b(free|paid|pay|payment|price|pricing|fee|fees|cost|charge|refund|subscription|subscribe|plan|renew|renewal|expire|expiry|validity|valid till|access|login|log in|account|upgrade|discount|coupon|offer|₹|rs\.?\s*\d|rupees|money|purchase|bought|buy)\b/i;
  // "I signed up but cannot find the case studies" is an ACCESS question wearing
  // the clothes of a navigation one. Answered as navigation it gets a tour of a
  // page the student cannot open; answered from their record it gets the truth,
  // which is that nothing has been taken on the account. Hindi and Hinglish
  // count — "portal par class nahi aa rahi" is the same sentence.
  const cannotSee =
    /(can'?t|cannot|unable to|not able to)\s+(find|see|open|access|watch|play|download)|not (showing|opening|visible|working|coming)|nahi (aa|mil|khul|chal)\s*rah|nhi aa rah|where (is|are) (my|the)|kaha(n)? (hai|milega)/i;
  return money.test(t) || cannotSee.test(t);
}

/** Instruction block for the model when the question is about their account. */
export function accountAnswerRules(facts: StudentFacts): string {
  return [
    "THIS IS A QUESTION ABOUT THE STUDENT'S OWN ACCESS, ACCOUNT OR MONEY.",
    "",
    "WHAT WE KNOW ABOUT THE PERSON WHO WROTE (this is the only true record — do not add to it):",
    ...facts.lines.map((l) => `- ${l}`),
    "",
    "RULES, IN ORDER:",
    "1. ANSWER THE QUESTION THEY ASKED. Not the nearest question. If they asked whether they",
    "   must pay, the first line of your reply says yes or no.",
    "2. IF THEY CANNOT FIND OR OPEN SOMETHING AND THE RECORD SHOWS NO PLAN RUNNING, that is the",
    "   answer — say plainly that nothing has been taken on their account yet, which is why the",
    "   subject and its material do not appear. Do not send them hunting through pages they",
    "   cannot open. Say where the plans are listed, and offer to trace a payment if they",
    "   believe they have already paid. Never claim they did or did not pay.",
    "3. Use ONLY the record above for anything about their access or plans. If it does not settle",
    "   the question, say a colleague will confirm — do NOT estimate, assume or reassure.",
    "4. NEVER state, imply or guess a price, a refund, a discount or what they previously bought.",
    "   If they ask about money already paid, that goes to a person.",
    "5. Do not list features they did not ask about. No sales writing.",
    "6. If you cannot follow rule 1 and rule 2 together, reply with exactly NEED_FACULTY.",
  ].join("\n");
}
