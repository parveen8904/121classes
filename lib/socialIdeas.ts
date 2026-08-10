import { createServiceClient } from "@/lib/supabase/service";
import { slotsForWeek, weekStart, type Slot, type SlotKind } from "@/lib/socialRhythm";

// WHAT TO ACTUALLY POST — DRAWN FROM WHAT IS ALREADY WRITTEN.
//
// The rhythm says a long-form piece goes out on Wednesday. It does not say
// about what, and "about what" is the part that stops people. There are 186
// published articles on this site, most of them never mentioned anywhere else,
// plus the announcements. So the plan proposes a real subject for every slot,
// taken from that pile, rather than an empty box marked "Wednesday".
//
// Two rules, both learned the hard way and both in the founder's standing
// instructions: nothing here writes in a sales voice, and nothing is invented.
// Every suggestion points at a piece that exists and can be read before it goes
// out. A recommendation the founder cannot check is a recommendation he has to
// rewrite, which is the same as no recommendation.

export type Idea = {
  title: string;
  body: string;
  sourceKind: "article" | "announcement" | "manual";
  sourceId: string | null;
  sourceUrl: string | null;
};

export type PlannedSlot = Slot & { idea: Idea };

type Article = { id: string; slug: string; title: string; description: string | null; category: string | null };

const SITE = "https://caparveensharma.com";

// Which pile a slot draws from.
//
// Long-form and video want a concept — something with enough in it to talk
// about for eight minutes. The daily line and the picture want something small
// and finishable. News suits LinkedIn, where the audience is professional; it
// does not suit a teaching video.
const WANTS: Record<SlotKind, { categories: string[]; fallbackAny: boolean }> = {
  longform: { categories: ["news", "fr", "aa"], fallbackAny: true },
  video:    { categories: ["fr", "aa"], fallbackAny: true },
  oneline:  { categories: ["fr", "aa", "news"], fallbackAny: true },
  visual:   { categories: ["fr", "aa"], fallbackAny: true },
  meeting:  { categories: [], fallbackAny: false },
};

/**
 * The articles worth proposing, freshest first, minus anything already used in
 * a plan. Reaching for the same well-written piece every fortnight is how a
 * feed starts to look automated.
 */
async function pickPool(svc: ReturnType<typeof createServiceClient>): Promise<Article[]> {
  const [{ data: arts }, { data: used }] = await Promise.all([
    svc.from("articles")
      .select("id, slug, title, description, category")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(300),
    svc.from("social_plan_slots").select("source_id").not("source_id", "is", null).limit(1000),
  ]);
  const spent = new Set((used ?? []).map((r) => String((r as { source_id: string }).source_id)));
  const all = (arts ?? []) as Article[];
  const fresh = all.filter((a) => !spent.has(a.id));
  // If every article has been used at some point, start round again rather than
  // proposing nothing — a stale suggestion beats an empty Wednesday.
  return fresh.length >= 12 ? fresh : all;
}

/** The idea for one slot, given a pool it may take from (and then not reuse). */
function ideaFor(slot: Slot, pool: Article[], taken: Set<string>): Idea {
  if (slot.kind === "meeting") {
    return {
      title: "Nova Seed Capital — fortnightly voice call",
      body:
        "Open voice room on Discord. Suggested shape: what moved in the last fortnight, " +
        "one thing being looked at now, and questions from whoever turns up. " +
        "Nothing is published from this — it is a conversation, not a broadcast.",
      sourceKind: "manual", sourceId: null, sourceUrl: null,
    };
  }

  const want = WANTS[slot.kind];
  const eligible = pool.filter((a) => !taken.has(a.id) &&
    (want.categories.includes(String(a.category ?? "")) || (want.fallbackAny && want.categories.length === 0)));
  const byPriority = want.categories
    .map((c) => eligible.filter((a) => String(a.category ?? "") === c))
    .find((g) => g.length > 0) ?? (want.fallbackAny ? pool.filter((a) => !taken.has(a.id)) : []);

  const pick = byPriority[0];
  if (!pick) {
    return {
      title: "(nothing suggested — write your own)",
      body: "No unused article was left to draw from. Anything you type here will be used as it stands.",
      sourceKind: "manual", sourceId: null, sourceUrl: null,
    };
  }
  taken.add(pick.id);

  const url = `${SITE}/articles/${pick.slug}`;
  const gist = (pick.description ?? "").trim();

  // The suggestion is a BRIEF, not finished copy. It says what to write about
  // and what shape it should take; the words are still his. Handing over
  // finished text is how a feed ends up sounding like nobody in particular.
  const body: Record<Exclude<SlotKind, "meeting">, string> = {
    longform:
      `Subject: ${pick.title}\n` +
      (gist ? `In short: ${gist}\n` : "") +
      `\nLinkedIn — the argument in about 150 words: what students (or practitioners) usually get wrong here, ` +
      `and the one distinction that clears it up. No call to action.\n` +
      `Medium — the same argument at length, with the worked example.\n` +
      `Substack — the same again as a letter: what you were asked this week that made you write it.\n` +
      `\nAlready written up here: ${url}`,
    video:
      `Topic: ${pick.title}\n` +
      (gist ? `In short: ${gist}\n` : "") +
      `\nEight to ten minutes. Open with the mistake, not the definition. One worked example on the board, ` +
      `then the exam angle — where this is asked from and what the examiner is looking for.\n` +
      `\nBackground: ${url}`,
    oneline:
      `One line on: ${pick.title}\n` +
      (gist ? `\nThe point to make: ${gist}\n` : "") +
      `\nA single statement somebody could use today. No link, no hashtags, nothing to click.`,
    visual:
      `Card on: ${pick.title}\n` +
      (gist ? `\nThe point: ${gist}\n` : "") +
      `\nOne image: the rule at the top, the worked figure below it. Caption in two lines. ` +
      `Same card to Instagram and Facebook.\n` +
      `\nSource: ${url}`,
  };

  return {
    title: pick.title,
    body: body[slot.kind as Exclude<SlotKind, "meeting">],
    sourceKind: "article",
    sourceId: pick.id,
    sourceUrl: url,
  };
}

/** The whole week, each slot with something to say. Nothing is written yet. */
export async function recommendWeek(mondayIso: string): Promise<PlannedSlot[]> {
  const svc = createServiceClient();
  const pool = await pickPool(svc);
  const taken = new Set<string>();
  return slotsForWeek(mondayIso).map((s) => ({ ...s, idea: ideaFor(s, pool, taken) }));
}

/**
 * Save a week's recommendation, without ever overwriting what he has already
 * decided. A slot he amended or dropped stays as he left it; only slots that
 * do not exist yet are inserted. Pressing "recommend" twice must be safe.
 */
export async function ensureWeekPlanned(mondayIso: string): Promise<{ added: number; kept: number }> {
  const svc = createServiceClient();
  const monday = weekStart(mondayIso);
  const { data: existing } = await svc
    .from("social_plan_slots").select("slot_date, slot_time, kind").eq("week_start", monday);
  const seen = new Set((existing ?? []).map((r) =>
    `${(r as { slot_date: string }).slot_date}|${(r as { slot_time: string }).slot_time}|${(r as { kind: string }).kind}`));

  const planned = await recommendWeek(monday);
  const rows = planned
    .filter((s) => !seen.has(`${s.date}|${s.time}|${s.kind}`))
    .map((s) => ({
      week_start: monday, slot_date: s.date, slot_time: s.time, kind: s.kind, channels: s.channels,
      idea_title: s.idea.title, idea_body: s.idea.body,
      source_kind: s.idea.sourceKind, source_id: s.idea.sourceId, source_url: s.idea.sourceUrl,
      status: "recommended",
    }));
  if (rows.length) await svc.from("social_plan_slots").insert(rows);
  return { added: rows.length, kept: seen.size };
}

export type StoredSlot = {
  id: string; week_start: string; slot_date: string; slot_time: string;
  kind: SlotKind; channels: string[];
  idea_title: string | null; idea_body: string | null;
  source_kind: string | null; source_url: string | null;
  status: string; scheduled_post_id: string | null;
};

export async function loadWeek(mondayIso: string): Promise<StoredSlot[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("social_plan_slots").select("*")
    .eq("week_start", weekStart(mondayIso))
    .order("slot_date", { ascending: true }).order("slot_time", { ascending: true });
  return (data ?? []) as StoredSlot[];
}
