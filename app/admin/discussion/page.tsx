import { formatDateTime } from "@/lib/dates";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { restoreMessage, hideMessage, banSender, unbanUser, saveBlockedTerms, makeStudentsOnlyLink } from "./actions";
import { botGroupStatus } from "@/lib/telegramGroup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group moderation — Admin" };

type Msg = { id: string; chat_id: string; sender_name: string | null; body: string | null; created_at: string; source: string; status: string; flagged: boolean; flag_reasons: string[] };

export default async function DiscussionAdmin(props: { searchParams: Promise<{ q?: string; group?: string; linked?: string; linkerr?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const q = (searchParams.q ?? "").trim();
  const group = searchParams.group ?? "";

  const [{ data: groups }, { data: subjects }] = await Promise.all([
    svc.from("telegram_groups").select("chat_id, title").order("title"),
    svc.from("subjects").select("title, telegram_group_chat_id, telegram_group_url"),
  ]);
  const subjByChat = new Map((subjects ?? []).filter((s) => s.telegram_group_chat_id).map((s) => [s.telegram_group_chat_id as string, s.title as string]));
  // Can the bot actually police each group? (admin + delete + ban rights)
  const groupChats = (subjects ?? []).filter((s) => s.telegram_group_chat_id).map((s) => ({ chat: s.telegram_group_chat_id as string, name: s.title as string, url: (s as { telegram_group_url?: string | null }).telegram_group_url ?? "" }));
  const botStatus = await botGroupStatus(groupChats.map((g) => g.chat));
  const groupName = (chat: string) => subjByChat.get(chat) || (groups ?? []).find((g) => g.chat_id === chat)?.title || chat;

  // Flagged / hidden — needs review.
  const { data: flagged } = await svc
    .from("group_messages")
    .select("id, chat_id, sender_name, body, created_at, source, status, flagged, flag_reasons")
    .eq("status", "hidden")
    .order("created_at", { ascending: false })
    .limit(50);

  // Search / browse all messages.
  let qb = svc
    .from("group_messages")
    .select("id, chat_id, sender_name, body, created_at, source, status, flagged, flag_reasons")
    .order("created_at", { ascending: false })
    .limit(100);
  if (group) qb = qb.eq("chat_id", group);
  if (q) qb = qb.ilike("body", `%${q}%`);
  const { data: messages } = await qb;

  const { data: bans } = await svc.from("banned_group_users").select("id, chat_id, user_id, tg_user_id, kind, reason, created_at").order("created_at", { ascending: false }).limit(50);
  const { data: btRow } = await svc.from("site_settings").select("value").eq("key", "moderation_blocked_terms").maybeSingle();
  const blockedTerms = (btRow?.value as string) ?? "";
  const { data: log } = await svc.from("message_moderation_log").select("action, reason, created_at").order("created_at", { ascending: false }).limit(20);

  const card = { background: "var(--bg-soft)", borderRadius: 10, padding: "10px 12px" } as const;
  const when = (s: string) => formatDateTime(s);

  const Row = ({ m, review }: { m: Msg; review?: boolean }) => (
    <div style={{ ...card, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: ".78rem", color: "var(--muted)" }}>
          {groupName(m.chat_id)} · {m.sender_name || "Member"} · {m.source} · {when(m.created_at)}
          {m.status === "hidden" && <span style={{ color: "#b91c1c", fontWeight: 700 }}> · hidden</span>}
        </div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: ".9rem", marginTop: 2 }}>{m.body}</div>
        {m.flag_reasons?.length > 0 && (
          <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {m.flag_reasons.map((r) => <span key={r} style={{ fontSize: ".7rem", background: "#fee2e2", color: "#b91c1c", padding: "1px 7px", borderRadius: 999 }}>{r}</span>)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {review || m.status === "hidden" ? (
          <form action={restoreMessage}><input type="hidden" name="id" value={m.id} /><SubmitButton className="btn small" style={{ background: "#16a34a" }}>Restore</SubmitButton></form>
        ) : (
          <form action={hideMessage}><input type="hidden" name="id" value={m.id} /><SubmitButton className="btn small secondary">Hide</SubmitButton></form>
        )}
        <form action={banSender}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="kind" value="mute" /><SubmitButton className="btn small secondary">Mute</SubmitButton></form>
        <form action={banSender}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="kind" value="ban" /><SubmitButton className="btn small secondary" style={{ color: "#b91c1c" }}>Ban</SubmitButton></form>
      </div>
    </div>
  );

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 920 }}>
      <AdminHero badge="🛡️ Group moderation" title="Discussion moderation" subtitle="Review flagged messages, search across all groups, hide messages and ban/mute users. Your DB is the record; Telegram is kept in sync." back={{ href: "/admin", label: "Admin" }} />

      {searchParams.linked === "1" && <div className="notice ok" style={{ marginTop: 12 }}>✅ A students-only join link was created and saved for the website. You can now safely make that group Private and delete its public link.</div>}
      {searchParams.linkerr === "1" && <div className="notice err" style={{ marginTop: 12 }}>Couldn&apos;t create the link — the bot must be an admin with &ldquo;Invite users via link&rdquo; permission in that group. Fix that, then try again.</div>}

      {/* Can the bot actually enforce the rules? It can only delete a message
          and remove a user if it is an ADMIN with those rights in the group. */}
      <h2 className="admin-section-title" style={{ marginTop: 18 }}>🤖 Bot rights per group</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {groupChats.map((g) => {
          const s = botStatus[g.chat];
          const ok = s?.admin && s?.canDelete && s?.canBan;
          return (
            <div key={g.chat} style={{ ...card, borderLeft: `4px solid ${ok ? "#16a34a" : "#b91c1c"}` }}>
              <strong>{ok ? "✅" : "⚠️"} {g.name}</strong>
              <div style={{ fontSize: ".84rem", marginTop: 3 }}>
                {ok
                  ? "Bot is an admin and can delete messages & remove users. Fully protected."
                  : <span style={{ color: "#b91c1c" }}>
                      {s?.note || "cannot verify"}{s?.present && s?.admin ? ` — missing: ${[!s.canDelete && "Delete messages", !s.canBan && "Ban users"].filter(Boolean).join(", ")}` : ""}.
                      {" "}<strong>Add the bot as an admin with &ldquo;Delete messages&rdquo; and &ldquo;Ban users&rdquo; turned on, or it cannot remove bad content.</strong>
                    </span>}
              </div>
              {/* The link the website hands students. If it is a public
                  "anyone can join" link, generate a private approval link so the
                  public one can be safely removed. */}
              <div style={{ fontSize: ".82rem", marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div>
                  Website join link:{" "}
                  {g.url
                    ? <code style={{ wordBreak: "break-all" }}>{g.url}</code>
                    : <span className="muted">none set</span>}
                  {g.url && !/\/\+|joinchat/.test(g.url) && <span style={{ color: "#b45309", fontWeight: 700 }}> · ⚠️ this is a PUBLIC link (anyone can join)</span>}
                  {g.url && /\/\+|joinchat/.test(g.url) && <span style={{ color: "#16a34a", fontWeight: 700 }}> · ✅ private (approval)</span>}
                </div>
                <form action={makeStudentsOnlyLink} style={{ marginTop: 8 }}>
                  <input type="hidden" name="chat_id" value={g.chat} />
                  <SubmitButton className="btn small" savedLabel="Creating…">🔗 Generate students-only join link (approval required)</SubmitButton>
                </form>
              </div>
            </div>
          );
        })}
        {groupChats.length === 0 && <div style={card}><span className="muted">No subject group is linked yet.</span></div>}
      </div>

      {/* Extra blocked words/phrases — competitor names, banned topics. */}
      <details className="card" style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          🚫 Blocked words &amp; competitor names {blockedTerms.trim() ? `(${blockedTerms.trim().split("\n").length})` : "(none yet)"}
        </summary>
        <form action={saveBlockedTerms} style={{ marginTop: 10 }}>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
            One word or phrase per line (e.g. a competitor&apos;s name). Any group message containing one is
            deleted automatically — on Telegram, Discord and the website. Links, phone numbers, ads,
            abusive language and adult content are already blocked built-in.
          </p>
          <textarea name="terms" rows={5} defaultValue={blockedTerms} placeholder={"competitor institute name\nanother coaching brand\npen drive classes"} style={{ width: "100%", fontFamily: "monospace" }} />
          <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save blocked terms</SubmitButton>
        </form>
      </details>

      <h2 className="admin-section-title">🚩 Flagged &amp; hidden — review ({(flagged ?? []).length})</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {(flagged ?? []).length === 0 ? <div className="card"><p className="muted">Nothing flagged. 🎉</p></div> : (flagged as Msg[]).map((m) => <Row key={m.id} m={m} review />)}
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 28 }}>🔎 Search all messages</h2>
      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input name="q" defaultValue={q} placeholder="Search message text…" style={{ marginBottom: 0, flex: "1 1 220px" }} />
        <select name="group" defaultValue={group} style={{ marginBottom: 0, maxWidth: 240 }}>
          <option value="">All groups</option>
          {(groups ?? []).map((g) => <option key={g.chat_id} value={g.chat_id}>{groupName(g.chat_id)}</option>)}
        </select>
        <button className="btn small" type="submit">Search</button>
      </form>
      <div style={{ display: "grid", gap: 8 }}>
        {(messages ?? []).length === 0 ? <div className="card"><p className="muted">No messages.</p></div> : (messages as Msg[]).map((m) => <Row key={m.id} m={m} />)}
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 28 }}>🚫 Banned / muted ({(bans ?? []).length})</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {(bans ?? []).length === 0 ? <div className="card"><p className="muted">No bans.</p></div> : (bans ?? []).map((b) => (
          <div key={b.id} style={{ ...card, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".85rem" }}>{b.kind === "ban" ? "🚫 Banned" : "🔇 Muted"} · {groupName(b.chat_id as string)} · {b.reason || b.tg_user_id || b.user_id} · {when(b.created_at as string)}</span>
            <form action={unbanUser}><input type="hidden" name="ban_id" value={b.id as string} /><SubmitButton className="btn small secondary">Remove</SubmitButton></form>
          </div>
        ))}
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 28 }}>📜 Recent moderation log</h2>
      <div style={{ display: "grid", gap: 4 }}>
        {(log ?? []).length === 0 ? <p className="muted">No actions yet.</p> : (log as { action: string; reason: string | null; created_at: string }[]).map((l, i) => (
          <div key={i} className="muted" style={{ fontSize: ".82rem" }}>{when(l.created_at)} — <strong>{l.action}</strong>{l.reason ? ` · ${l.reason}` : ""}</div>
        ))}
      </div>
    </section>
  );
}
