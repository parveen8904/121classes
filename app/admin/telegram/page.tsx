import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import SubmitButton from "@/app/components/SubmitButton";
import { linkGroupToSubject, sendTelegramManual, saveTelegramSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Telegram broadcast — Admin" };

export default async function TelegramAdminPage(props: { searchParams: Promise<{ sent?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const [{ data: subjects }, { data: groups }] = await Promise.all([
    svc.from("subjects").select("id, title, telegram_group_chat_id").order("title"),
    svc.from("telegram_groups").select("chat_id, title, added_at").order("added_at", { ascending: false }),
  ]);
  const channelId = await getSecret("TELEGRAM_CHANNEL_ID");
  const connectedOnly = (await getSecret("telegram_connected_only")) === "1";
  const subjectByChat = new Map((subjects ?? []).filter((s) => s.telegram_group_chat_id).map((s) => [s.telegram_group_chat_id as string, s.title as string]));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero badge="✈️ Telegram" title="Telegram broadcast" subtitle="Link subject groups, then post to the channel or any group — manually or automatically." back={{ href: "/admin", label: "Admin" }} />

      {searchParams.sent && <div className="notice ok" style={{ marginTop: 16 }}>✅ Sent.</div>}

      <div className="card" style={{ marginTop: 16, background: "var(--bg-soft,#f8fafc)" }}>
        <strong>Setup, in order</strong>
        <ol style={{ fontSize: ".85rem", margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Create each subject&apos;s Telegram group.</li>
          <li>Add <strong>@Caclassesbot</strong> to the group and make it an <strong>admin</strong>.</li>
          <li>Type any message in the group — it then appears below under &ldquo;Groups the bot is in.&rdquo;</li>
          <li>Pick its subject in the dropdown and click <strong>Link</strong>.</li>
          <li>(For the channel: add the bot as admin of your channel — the channel ID is already set.)</li>
        </ol>
      </div>

      {/* Doubt-answering policy */}
      <form action={saveTelegramSettings} className="form-card" style={{ marginTop: 18 }}>
        <h3>🔒 Who can ask the bot doubts</h3>
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" name="connected_only" defaultChecked={connectedOnly} /> Only answer doubts from <strong>connected</strong> students
        </label>
        <p className="muted" style={{ fontSize: ".8rem", margin: "6px 0 10px" }}>
          When on, anyone who hasn&apos;t connected their account is asked to connect first — so students join to use the bot. When off, the bot answers everyone.
        </p>
        <SubmitButton className="btn small" savedLabel="✓ Saved">Save</SubmitButton>
      </form>

      {/* Manual send */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>📣 Send a message</h3>
        <form action={sendTelegramManual}>
          <label>Message</label>
          <textarea name="text" rows={3} required placeholder="Type your message…" />
          <label>Link (optional)</label>
          <input name="link" placeholder="https://…" />
          <label>Send to</label>
          <select name="target" defaultValue="channel">
            <option value="channel">📢 Telegram channel{channelId ? "" : " (set TELEGRAM_CHANNEL_ID first)"}</option>
            <option value="all">👥 All subject groups</option>
            {(subjects ?? []).filter((s) => s.telegram_group_chat_id).map((s) => <option key={s.id} value={s.id}>👥 {s.title} group</option>)}
          </select>
          <SubmitButton className="btn" style={{ marginTop: 12 }} savedLabel="✓ Sent">Send</SubmitButton>
        </form>
      </div>

      {/* Link captured groups to subjects */}
      <h2 className="admin-section-title" style={{ marginTop: 24 }}>👥 Groups the bot is in</h2>
      <p className="muted" style={{ fontSize: ".85rem" }}>Add <strong>@Caclassesbot</strong> to a subject&apos;s Telegram group (as admin) — it appears here automatically. Then link it to its subject so auto-posts go to the right group.</p>
      {(groups ?? []).length === 0 ? (
        <p className="muted">No groups yet. Add the bot to a group and send any message there; it&apos;ll show up here.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {(groups ?? []).map((g) => (
            <form key={g.chat_id} action={linkGroupToSubject} className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="chat_id" value={g.chat_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{g.title}</strong>
                <div className="muted" style={{ fontSize: ".78rem" }}>chat {g.chat_id}{subjectByChat.get(g.chat_id) ? ` · linked to ${subjectByChat.get(g.chat_id)}` : " · not linked"}</div>
              </div>
              <select name="subject_id" defaultValue={(subjects ?? []).find((s) => s.telegram_group_chat_id === g.chat_id)?.id ?? ""}>
                <option value="">— not linked —</option>
                {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <SubmitButton className="btn small" savedLabel="✓">Link</SubmitButton>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
