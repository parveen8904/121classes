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
  const out: StudentFacts = { known: false, name: null, email: addr, lines: [] };
  if (!addr.includes("@")) return out;

  try {
    const svc = createServiceClient();
    const { data: profile } = await svc
      .from("profiles")
      .select("id, full_name, email, study_level, created_at")
      .ilike("email", addr)
      .maybeSingle();

    if (!profile?.id) {
      out.lines.push("This email does NOT have an account on the site.");
      return out;
    }

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
  return /\b(free|paid|pay|payment|price|pricing|fee|fees|cost|charge|refund|subscription|subscribe|plan|renew|renewal|expire|expiry|validity|valid till|access|login|log in|account|upgrade|discount|coupon|offer|₹|rs\.?\s*\d|rupees|money|purchase|bought|buy)\b/i
    .test(text ?? "");
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
    "2. Use ONLY the record above for anything about their access or plans. If it does not settle",
    "   the question, say a colleague will confirm — do NOT estimate, assume or reassure.",
    "3. NEVER state, imply or guess a price, a refund, a discount or what they previously bought.",
    "   If they ask about money already paid, that goes to a person.",
    "4. Do not list features they did not ask about. No sales writing.",
    "5. If you cannot follow rule 1 and rule 2 together, reply with exactly NEED_FACULTY.",
  ].join("\n");
}
