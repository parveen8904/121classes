import { createServiceClient } from "@/lib/supabase/service";
import { selectAll, inChunks } from "@/lib/pageAll";

// WHO EACH CHANNEL ACTUALLY REACHES.
//
// "Send via: Telegram, email, WhatsApp, app" gave no idea how many people were
// behind each tick, so a broadcast was an act of faith. Worse, when one of them
// appeared not to arrive there was nothing to look at — the first push that did
// not reach an iPhone could not be explained, because nobody had recorded that
// there were no iPhones registered yet at the time.
//
// The counts here are read the same way everywhere else now is: in pages, so a
// channel with more than a thousand people is not quietly described as having a
// thousand.

export type Person = { name: string; detail?: string; when?: string };
export type Channel = {
  key: string;
  label: string;
  count: number;
  /** Named people, where names exist and the list is short enough to show. */
  people: Person[];
  /** Said plainly when a number needs explaining. */
  note?: string;
};

const NAME_LIMIT = 50;

export async function reachStats(): Promise<Channel[]> {
  const svc = createServiceClient();
  const out: Channel[] = [];

  // ── The apps ─────────────────────────────────────────────────────────────
  // Named, because these are the people who have the app AND agreed to be
  // notified — the most valuable list here, and today the shortest.
  // NAMES ARE FETCHED SEPARATELY, ON PURPOSE.
  //
  // This asked PostgREST to embed profiles through push_devices.user_id — but
  // that column's foreign key points at auth.users, not profiles, so there was
  // no relationship to follow. PostgREST refused the whole query, the refusal
  // was swallowed as an empty list, and the page reported nobody registered on
  // either platform while eleven phones sat in the table waiting.
  //
  // "No devices" and "the query failed" must never look the same again.
  const devices = await selectAll<{ platform: string; created_at: string; user_id: string | null; device: string | null }>((f, t) =>
    svc.from("push_devices")
      .select("platform, created_at, user_id, device")
      .is("disabled_at", null)
      .order("created_at", { ascending: false })
      .range(f, t),
  );

  const owners = await inChunks<{ id: string; full_name: string | null; email: string | null }>(
    [...new Set(devices.map((d) => d.user_id).filter(Boolean))] as string[],
    (b) => svc.from("profiles").select("id, full_name, email").in("id", b),
  );
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  for (const [key, label] of [["ios", "iPhone / iPad"], ["android", "Android"]] as const) {
    const mine = devices.filter((d) => d.platform === key);
    out.push({
      key: `push_${key}`,
      label,
      count: mine.length,
      people: mine.slice(0, NAME_LIMIT).map((d) => {
        const o = d.user_id ? ownerById.get(d.user_id) : undefined;
        return {
          // A phone with no account behind it is still on the list, and is
          // said so plainly rather than shown as a dash — these are people who
          // installed the app and allowed notifications without registering,
          // and they DO receive general announcements.
          name: o?.full_name || o?.email || (d.user_id ? "—" : "App installed · not signed in"),
          // The phone itself where it says so, since a phone never gives a
          // person's name — Android names its model, iOS says only "iPhone".
          detail: [o?.email, d.device].filter(Boolean).join(" · ") || undefined,
          when: d.created_at,
        };
      }),
      note: mine.length === 0
        ? "Nobody yet. A phone appears here once it has the app and notifications are allowed — signing in is not required."
        : (() => {
            const anon = mine.filter((d) => !d.user_id).length;
            return anon
              ? `${anon} of these have the app but have not signed in. They get general announcements, but nothing about a subject — we do not know what they study.`
              : undefined;
          })(),
    });
  }

  // ── Telegram ─────────────────────────────────────────────────────────────
  // Two separate populations that people conflate: students who connected the
  // bot to their account, and anyone who pressed Start on the bot without ever
  // signing in. A broadcast reaches both.
  const [linked, subs] = await Promise.all([
    selectAll<{ full_name: string | null; email: string | null; telegram_chat_id: string }>((f, t) =>
      svc.from("profiles").select("full_name, email, telegram_chat_id")
        .not("telegram_chat_id", "is", null).range(f, t)),
    selectAll<{ chat_id: string; first_name: string | null; created_at: string }>((f, t) =>
      svc.from("telegram_subscribers").select("chat_id, first_name, created_at")
        .order("created_at", { ascending: false }).range(f, t)),
  ]);
  const linkedIds = new Set(linked.map((r) => String(r.telegram_chat_id)));
  const extra = subs.filter((s) => !linkedIds.has(String(s.chat_id)));

  out.push({
    key: "telegram",
    label: "Telegram — personal messages",
    count: linkedIds.size + extra.length,
    people: [
      ...linked.slice(0, NAME_LIMIT).map((r) => ({ name: r.full_name || r.email || "—", detail: r.email ?? undefined })),
      ...extra.slice(0, Math.max(0, NAME_LIMIT - linked.length)).map((s) => ({
        name: s.first_name || "Telegram user", detail: "pressed Start on the bot, not signed in", when: s.created_at,
      })),
    ],
    note: `${linkedIds.size} students who connected the bot, plus ${extra.length} who pressed Start without signing in.`,
  });

  // ── Telegram channel & Discord ───────────────────────────────────────────
  // One post to a channel; the platform decides who sees it. There is no list
  // to count, and pretending otherwise would be worse than saying so.
  out.push({
    key: "telegram_channel",
    label: "Telegram channel",
    count: -1,
    people: [],
    note: "One post reaches every member instantly. Telegram does not tell us the member count through the bot.",
  });
  out.push({
    key: "discord",
    label: "Discord channel",
    count: -1,
    people: [],
    note: "Posted through a webhook. Discord gives no audience figure back.",
  });

  // ── Email & WhatsApp ─────────────────────────────────────────────────────
  const [emailable, phoneable] = await Promise.all([
    svc.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").not("email", "is", null),
    svc.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").not("phone", "is", null),
  ]);
  out.push({
    key: "email", label: "Email", count: emailable.count ?? 0, people: [],
    note: "Students with an email address on file. Sent 500 per click.",
  });
  out.push({
    key: "whatsapp", label: "WhatsApp", count: phoneable.count ?? 0, people: [],
    note: "Students with a phone number. Meta caps an unverified business at 250 messages a day.",
  });

  return out;
}
