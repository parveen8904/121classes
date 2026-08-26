import { createServiceClient } from "@/lib/supabase/service";

// WHEN A STUDY GROUP GOES QUIET, GIVE IT SOMETHING TO DO.
//
// His instruction, 26 Aug 2026: if the groups stay silent, keep telling them
// to take a test, work the planner, look at the new articleship openings,
// apply for the scholarship, or read a new article.
//
// The rules that keep this a nudge and not a nuisance:
//
//   · SILENT MEANS SILENT. A group with students talking in it is left alone
//     entirely — this speaks into an empty room, never over a conversation.
//   · ONCE A DAY AT MOST, and only in waking hours IST. A study group pinged
//     at 3 AM is an app people mute.
//   · IT ROTATES. The five never repeat until all five have been used, so a
//     quiet week does not become the same sentence five times.
//   · NO SELLING. Everything here is something the student has already paid
//     for or is entitled to; this is not a place for offers.

export type NudgeKind = "test" | "planner" | "articleship" | "scholarship" | "article";

export const NUDGE_KINDS: NudgeKind[] = ["test", "planner", "articleship", "scholarship", "article"];

const SITE = "https://caparveensharma.com";

/** Hours of quiet before a group is considered idle. */
export const IDLE_HOURS = 12;
/** Never nudge the same group more often than this. */
export const MIN_GAP_HOURS = 20;
/** IST hours during which a nudge may be posted (inclusive start, exclusive end). */
export const AWAKE_FROM = 9;
export const AWAKE_TO = 21;

/** The IST hour of an instant, 0-23. */
export function istHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false,
  }).format(now));
}

export type Nudge = { kind: NudgeKind; text: string; link: string };

/**
 * The words for one nudge. `article` needs the newest published article, so it
 * is passed in — when there is none, the caller picks a different kind rather
 * than posting a link to nothing.
 */
export function nudgeText(
  kind: NudgeKind,
  article?: { title: string; slug: string } | null,
): Nudge | null {
  switch (kind) {
    case "test":
      return {
        kind,
        text: "📝 Quiet in here today. Have you attempted a test this week?\n\n" +
          "Writing one paper teaches more than reading three chapters — and it is checked and returned to you.",
        link: `${SITE}/mock-tests`,
      };
    case "planner":
      return {
        kind,
        text: "🗓️ A quiet day is a good day to look at your planner.\n\n" +
          "See what is due, what has slipped, and let it rebuild the rest of your dates around today.",
        link: `${SITE}/planner`,
      };
    case "articleship":
      return {
        kind,
        text: "💼 New articleship openings have been added.\n\n" +
          "Fresh vacancies are posted as firms send them — worth a look before they fill.",
        link: `${SITE}/career`,
      };
    case "scholarship":
      return {
        kind,
        text: "🎓 Scholarship applications are open.\n\n" +
          "If the fees are a strain, apply — it is assessed on merit and need, and asking costs nothing.",
        link: `${SITE}/scholarship`,
      };
    case "article":
      if (!article) return null;
      return {
        kind,
        text: `📖 New article — ${article.title}`,
        link: `${SITE}/articles/${article.slug}`,
      };
  }
}

/** The newest published article, or null. */
export async function latestArticle(): Promise<{ title: string; slug: string } | null> {
  const { data } = await createServiceClient()
    .from("articles")
    .select("title, slug")
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { title: String(data.title), slug: String(data.slug) } : null;
}

/**
 * Choose the next kind for a group: the one used least recently, so all five
 * cycle before any repeats. `article` is skipped when nothing is published.
 */
export async function nextKind(chatId: string, haveArticle: boolean): Promise<NudgeKind | null> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("group_nudges")
    .select("kind, sent_at")
    .eq("chat_id", chatId)
    .order("sent_at", { ascending: false })
    .limit(50);

  const pool = NUDGE_KINDS.filter((k) => haveArticle || k !== "article");
  if (!pool.length) return null;

  // Most recent use of each kind; never used sorts first.
  const lastUsed = new Map<string, string>();
  for (const r of data ?? []) {
    const k = String((r as { kind: string }).kind);
    if (!lastUsed.has(k)) lastUsed.set(k, String((r as { sent_at: string }).sent_at));
  }
  const unused = pool.filter((k) => !lastUsed.has(k));
  if (unused.length) return unused[0];
  return [...pool].sort((a, b) => (lastUsed.get(a) ?? "").localeCompare(lastUsed.get(b) ?? ""))[0];
}

/** Is this group quiet enough, and is it long enough since the last nudge? */
export async function shouldNudge(chatId: string, now = new Date()): Promise<boolean> {
  const svc = createServiceClient();

  // A HUMAN message. The bot's own posts — including the last nudge — must not
  // make the room look busy, or a group nudged once would never be nudged
  // again.
  const { data: lastHuman } = await svc
    .from("group_messages")
    .select("created_at")
    .eq("chat_id", chatId)
    .not("sender_tg_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastHuman?.created_at) {
    const quietFor = (now.getTime() - new Date(String(lastHuman.created_at)).getTime()) / 3600e3;
    if (quietFor < IDLE_HOURS) return false;
  }

  const { data: lastNudge } = await svc
    .from("group_nudges")
    .select("sent_at")
    .eq("chat_id", chatId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastNudge?.sent_at) {
    const since = (now.getTime() - new Date(String(lastNudge.sent_at)).getTime()) / 3600e3;
    if (since < MIN_GAP_HOURS) return false;
  }
  return true;
}

/** Record that a nudge went out. */
export async function recordNudge(chatId: string, kind: NudgeKind): Promise<void> {
  try {
    await createServiceClient().from("group_nudges").insert({ chat_id: chatId, kind });
  } catch { /* a nudge that sent but did not record is better than a double send blocking */ }
}
