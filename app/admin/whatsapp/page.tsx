import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import AdminHero from "../_components/AdminHero";
import { replyOnWhatsApp, draftWhatsAppReply, saveWhatsAppAutoReply } from "./actions";
import { getAutoReply } from "@/lib/whatsappAutoReply";

// The WhatsApp inbox. A Cloud API number cannot use the WhatsApp app and does
// NOT appear in Meta's Business Suite inbox (verified: that page 404s for this
// number), so conversations live here — fed by the webhook at
// /api/whatsapp/webhook, which records every inbound message.

export const dynamic = "force-dynamic";

type Row = { id: string; template: string; payload: Record<string, unknown> | null; sent_at: string | null; status: string | null };

function pretty(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("91") && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
}

function textOf(p: Record<string, unknown> | null): string {
  if (!p) return "";
  const direct = typeof p.text === "string" ? p.text : "";
  if (direct) return direct;
  const t = p.text as { body?: string } | undefined;
  if (t?.body) return t.body;
  const b = p.button as { text?: string } | undefined;
  if (b?.text) return b.text;
  const type = typeof p.type === "string" ? p.type : "";
  return type ? `(${type} message — WhatsApp does not pass its content to businesses)` : "";
}

export default async function AdminWhatsAppPage(props: { searchParams: Promise<{ sent?: string; saved?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();

  const { data } = await svc
    .from("notifications")
    .select("id, template, payload, sent_at, status")
    .eq("channel", "whatsapp")
    .in("template", ["inbound", "outbound"])
    .order("id", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as Row[];
  const number = await getSecret("WHATSAPP_PHONE_NUMBER_ID");
  const auto = await getAutoReply();

  // Group by the other party's number, newest conversation first.
  // The drafts written by the AI, waiting to be read and sent.
  const { data: draftRows } = await svc
    .from("site_settings")
    .select("key, value")
    .like("key", "wadraft:%");
  const drafts = new Map(
    (draftRows ?? [])
      .filter((d) => String(d.value ?? "").trim())
      .map((d) => [String(d.key).replace("wadraft:", ""), String(d.value)]),
  );

  const threads = new Map<string, Row[]>();
  for (const r of rows) {
    const p = r.payload ?? {};
    const who = String((r.template === "inbound" ? p.from : p.to) ?? "");
    if (!who) continue;
    if (!threads.has(who)) threads.set(who, []);
    threads.get(who)!.push(r);
  }

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="💬 WhatsApp"
        title="WhatsApp inbox"
        subtitle="Messages sent to +91 98100 79162. This number runs on Meta's Cloud API, so it cannot be opened in the WhatsApp app — this page is the inbox."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* The same question-and-answer record as every other channel. This page
          is the conversation; that one is the read-through. */}
      <p style={{ marginTop: -6 }}>
        <a className="btn small secondary" href="/admin/doubt-log?days=30&channel=whatsapp">
          🗒️ Read the questions and answers &rarr;
        </a>
      </p>

      {searchParams.sent === "1" && <div className="notice ok">Reply sent.</div>}
      {searchParams.sent === "0" && (
        <div className="notice err">
          Not delivered. Free replies only work within 24 hours of the student&apos;s last message; after that only an approved
          template can be sent.
        </div>
      )}

      {searchParams.saved === "1" && <div className="notice ok">Auto-reply saved.</div>}

      {/* The instant reply every incoming message gets. */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 className="admin-section-title">⚡ Instant auto-reply</h2>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
          Sent the moment anyone messages the number, so nobody is left waiting in silence. Once per sender per 12 hours —
          a long conversation never gets a robot between every line. Your own replies below are always personal.
        </p>
        <form action={saveWhatsAppAutoReply}>
          <textarea name="text" defaultValue={auto.text} rows={9} style={{ width: "100%", fontSize: ".9rem" }} />
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <label className="remember" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="on" defaultChecked={auto.on} /> Send this automatically
            </label>
            <SubmitButton className="btn small" savedLabel="Saved ✓">💾 Save auto-reply</SubmitButton>
          </div>
        </form>
      </div>

      {!number && (
        <div className="notice err">WhatsApp is not configured — add the Cloud API keys on the Integrations page.</div>
      )}

      <p className="muted" style={{ fontSize: ".85rem", marginBottom: 14 }}>
        <a href="/admin/whatsapp/connect">📲 Connect your own number (keeps it on your phone)</a> — students then
        reach you on the number they already use, and replies are drafted here for you to send.
      </p>

      {threads.size === 0 ? (
        <div className="card">
          <p className="muted">
            No messages yet. Anything a student sends to +91 98100 79162 will appear here within seconds.
          </p>
        </div>
      ) : (
        [...threads.entries()].map(([who, msgs]) => (
          <div className="card" key={who} style={{ marginBottom: 16 }}>
            <h2 className="admin-section-title">{pretty(who)}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {msgs
                .slice()
                .reverse()
                .map((m) => (
                  <div key={m.id} className="list-row">
                    <div>
                      <div className="row-title">
                        {m.template === "inbound" ? "⬅️ Student" : "➡️ You"}
                        {m.status === "failed" && " — not delivered"}
                      </div>
                      <div className="row-sub">{textOf(m.payload) || <span className="muted">(no text)</span>}</div>
                    </div>
                  </div>
                ))}
            </div>
            {/* Draft, then send. The AI writes the answer from CA Parveen
                Sharma's own material and stops there — nothing leaves the
                account until he presses Reply. */}
            <form action={draftWhatsAppReply} style={{ marginBottom: 8 }}>
              <input type="hidden" name="to" value={who} />
              <input type="hidden" name="question" value={lastInbound(msgs)} />
              <SubmitButton className="btn small secondary" savedLabel="Drafting…">
                ✍️ Draft a reply from my material
              </SubmitButton>
            </form>
            <form action={replyOnWhatsApp}>
              <input type="hidden" name="to" value={who} />
              <textarea
                name="text"
                placeholder="Type a reply…"
                maxLength={4000}
                rows={drafts.get(who) ? 8 : 2}
                defaultValue={drafts.get(who) ?? ""}
                style={{ width: "100%", marginBottom: 8 }}
              />
              <SubmitButton className="btn small" savedLabel="Sending…">
                Send
              </SubmitButton>
            </form>
          </div>
        ))
      )}
    </section>
  );
}

/** The newest thing the student actually said — what a draft should answer. */
function lastInbound(msgs: Row[]): string {
  for (const m of msgs) {
    if (m.template === "inbound") {
      const t = textOf(m.payload);
      if (t) return t.slice(0, 2000);
    }
  }
  return "";
}
