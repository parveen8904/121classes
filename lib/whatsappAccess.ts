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
//   Everyone else   — FIVE questions a day, then told plainly that this is a
//                     paid service and what a plan opens. A stranger is also
//                     asked to make a free account, since they have none.
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

// FIVE A DAY ON THE FREE PLAN, set by the founder. The same five whether or not
// they have registered — the difference between a stranger and a registered
// student is what we ask them to do next, not how much they are owed.
const FREE_DAILY = 5;

const ALLOWANCE: Record<WaTier, number> = {
  paying: 1000,   // effectively unlimited; still a ceiling against a runaway loop
  registered: FREE_DAILY,
  stranger: FREE_DAILY,
};

/** Last ten digits, so 919810012345 and 9810012345 are one person. */
const tail = (phone: string) => (phone ?? "").replace(/\D/g, "").slice(-10);

/**
 * Is the free-plan limit switched on?
 *
 * OFF by default, and deliberately. Answering strangers for nothing is
 * marketing: somebody who has never heard of us asks a question at midnight,
 * gets a real answer from Sir's own classes, and that is the whole pitch made
 * without a word of selling. The founder wants that running while the launch is
 * fresh, and a switch to close it the day it stops paying for itself.
 */
export async function limitOn(): Promise<boolean> {
  try {
    const { data } = await createServiceClient()
      .from("site_settings").select("value").eq("key", "wa_free_limit_on").maybeSingle();
    return String(data?.value ?? "") === "1";
  } catch {
    // If we cannot tell, keep answering. A limit applied by accident turns
    // students away; one skipped by accident costs a few pennies.
    return false;
  }
}

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
  const enforcing = await limitOn();
  return {
    tier,
    answeredToday,
    allowance,
    // With the limit off, everybody is allowed — the count is still kept, so
    // the day it is switched on there is already a record of who asks how much.
    allowed: !enforcing || tier === "paying" || answeredToday < allowance,
    name,
  };
}

/**
 * A stranger, remembered.
 *
 * Somebody who writes in without an account is a person interested enough to
 * type a question — the warmest lead there is, and until now they left no trace
 * beyond a message nobody counted. Recorded once, never duplicated, and never
 * for a number that already belongs to a student.
 */
export async function rememberStranger(from: string, firstQuestion: string): Promise<void> {
  const digits = tail(from);
  if (digits.length !== 10) return;
  try {
    const svc = createServiceClient();

    const { data: known } = await svc
      .from("leads").select("id").eq("phone", digits).limit(1).maybeSingle();
    if (known?.id) return;

    await svc.from("leads").insert({
      phone: digits,
      source: "whatsapp",
      note: `Asked on WhatsApp: ${firstQuestion.slice(0, 200)}`,
      verified: false,
    });
  } catch { /* a missed lead must never cost the student their answer */ }
}

/** Said once to a stranger, under their answer. Never twice. */
export const JOIN_INVITE =
  "\n\n———\n" +
  "You are not registered with us yet. An account is free and takes a minute — " +
  "it opens the first 5 classes of every subject, the practice papers and the study planner:\n" +
  "caparveensharma.com\n\n" +
  "The classes also work offline in our app:\n" +
  "Android: https://play.google.com/store/apps/details?id=in.caclasses.app\n" +
  "iPhone: https://apps.apple.com/app/id6789032629";

/**
 * What to say when the allowance is used up.
 *
 * Carries a marker so it is never counted as an answer — otherwise the notice
 * itself would consume the next day's allowance.
 */
export function gateMessage(a: WaAccess): string {
  const hi = a.name ? `${a.name.split(" ")[0]}, ` : "";

  const limit =
    `${hi}that is ${a.allowance} questions today, which is the daily limit on the free plan — ` +
    `five questions a day, and they reset tomorrow morning.\n\n` +
    `Beyond that this is a paid service: you need a plan to keep asking. A plan also opens the ` +
    `classes, the question bank, the hitlist, and gets your written papers checked.\n` +
    `caparveensharma.com/pricing\n\n`;

  const free =
    `Free either way:\n` +
    `• The first 5 classes of every subject\n` +
    `• Revision Test Papers, Mock Test Papers and past exam papers — caparveensharma.com/notes\n` +
    `• Case-scenario MCQs — caparveensharma.com/try/cases\n\n`;

  if (a.tier === "stranger") {
    return (
      limit +
      `This number is not registered with us either. An account is free and takes a minute: ` +
      `caparveensharma.com\n\n` +
      free +
      `— CA Parveen Sharma Classes [[gate]]`
    );
  }

  return limit + free + `— CA Parveen Sharma Classes [[gate]]`;
}
