import { createServiceClient } from "@/lib/supabase/service";

// WHO IS ALLOWED HOW MUCH, ON A NUMBER ANYONE CAN FIND.
//
// The business number is printed on the website, so knowing it costs nothing.
// Twenty-five numbers have written in; thirteen have an account and exactly ONE
// is paying. The other twenty-four were getting unlimited tutoring built on
// material this business sells — asked, answered, from his own classes, free.
//
// The answer is not a wall. A student who has not paid yet is a student, and
// the first question they ask is often how to buy. So:
//
//   Paying          — unlimited, as they have bought.
//   Registered      — a few full answers a day, then told plainly what a plan
//                     opens, and pointed at the genuinely free things.
//   Unknown number  — one full answer, then asked to make a free account.
//
// Everyone always gets something true and useful. Nobody is met with silence,
// and nobody is scolded for asking.
//
// DISTRESS IS NEVER GATED. That check runs before any of this and does not
// consult it — somebody in trouble is not a billing question.

export type WaTier = "paying" | "registered" | "stranger";

export type WaAccess = {
  tier: WaTier;
  answeredToday: number;
  allowance: number;
  /** May we answer this one in full? */
  allowed: boolean;
  name: string | null;
};

const ALLOWANCE: Record<WaTier, number> = {
  paying: 1000,   // effectively unlimited; still a ceiling against a runaway loop
  registered: 3,
  stranger: 1,
};

/** Last ten digits, so 919810012345 and 9810012345 are one person. */
const tail = (phone: string) => (phone ?? "").replace(/\D/g, "").slice(-10);

export async function whatsappAccess(from: string): Promise<WaAccess> {
  const svc = createServiceClient();
  const digits = tail(from);

  let tier: WaTier = "stranger";
  let name: string | null = null;

  if (digits.length === 10) {
    try {
      const { data: p } = await svc
        .from("profiles")
        .select("id, full_name")
        .ilike("phone", `%${digits}`)
        .limit(1)
        .maybeSingle();

      if (p?.id) {
        tier = "registered";
        name = (p.full_name as string) ?? null;
        const { count } = await svc
          .from("subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("student_id", p.id)
          .eq("status", "active")
          .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`);
        if ((count ?? 0) > 0) tier = "paying";
      }
    } catch {
      // Unrecognised is the safe default: they still get an answer, just one.
    }
  }

  // How many full answers have already gone to this number today. Counted from
  // what was actually SENT, so a message that failed does not use up somebody's
  // allowance.
  let answeredToday = 0;
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { data } = await svc
      .from("notifications")
      .select("payload")
      .eq("channel", "whatsapp")
      .eq("template", "outbound")
      .eq("status", "sent")
      .gte("sent_at", since.toISOString())
      .limit(500);

    answeredToday = (data ?? []).filter((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      if (String(p.to ?? "") !== from) return false;
      // Gate notices and greetings are not answers and must not count against
      // the person who received them.
      const body = String((p.text as { body?: string } | undefined)?.body ?? "");
      return !body.includes("[[gate]]");
    }).length;
  } catch {
    /* counting failed — err toward answering */
  }

  const allowance = ALLOWANCE[tier];
  return { tier, answeredToday, allowance, allowed: answeredToday < allowance, name };
}

/**
 * What to say when the allowance is used up.
 *
 * Carries a marker so it is never counted as an answer — otherwise the notice
 * itself would consume the next day's allowance.
 */
export function gateMessage(a: WaAccess): string {
  const hi = a.name ? `${a.name.split(" ")[0]}, ` : "";

  if (a.tier === "stranger") {
    return (
      `${hi}happy to help — but I can only answer properly for students with an account here, and this ` +
      `number is not registered yet.\n\n` +
      `Making one is free and takes a minute: caparveensharma.com\n\n` +
      `Once you are in, these cost nothing:\n` +
      `• The first 5 classes of every subject\n` +
      `• Revision Test Papers, Mock Test Papers and past papers — caparveensharma.com/notes\n` +
      `• Free case-scenario MCQs — caparveensharma.com/try/cases\n\n` +
      `Sign up and ask me again — I answer from CA Parveen Sharma's own classes.\n\n` +
      `— CA Parveen Sharma Classes [[gate]]`
    );
  }

  return (
    `${hi}that is your ${a.allowance} free doubts for today — do come back tomorrow.\n\n` +
    `Students on a plan can ask as much as they like, and get the classes, the question bank, ` +
    `the hitlist and their written papers checked. The plans are at caparveensharma.com/pricing\n\n` +
    `Free in the meantime: the first 5 classes of every subject, and the practice papers at ` +
    `caparveensharma.com/notes\n\n` +
    `— CA Parveen Sharma Classes [[gate]]`
  );
}
