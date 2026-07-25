import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { approveAndSend, rejectDraft } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Re-engagement — Admin" };

const KIND_LABEL: Record<string, string> = {
  never_started: "🆕 Signed up, never started",
  inactive_14d: "😴 Inactive 14+ days",
};

type Draft = {
  id: string; kind: string; email: string; subject: string; body: string;
  status: string; created_at: string; sent_at: string | null;
  profiles: { full_name: string | null } | null;
};

export default async function ReengagePage() {
  const svc = createServiceClient();
  const { data } = await svc
    .from("reengage_drafts")
    .select("id, kind, email, subject, body, status, created_at, sent_at, profiles:student_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  const drafts = ((data ?? []) as unknown as Draft[]);
  const pending = drafts.filter((d) => d.status === "draft");
  const done = drafts.filter((d) => d.status !== "draft").slice(0, 50);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="🔁 Re-engagement"
        title="Bring-them-back emails"
        subtitle="Drafted automatically every night — NOTHING is sent until your team approves each email here. ✅"
        back={{ href: "/admin", label: "Admin" }}
      />

      <h3 style={{ margin: "22px 0 8px" }}>⏳ Waiting for your approval ({pending.length})</h3>
      <div style={{ display: "grid", gap: 12 }}>
        {pending.length === 0 && (
          <div className="card"><p className="muted" style={{ margin: 0 }}>
            Nothing waiting. New drafts appear each morning for students who signed up but never started,
            and students inactive for 14+ days.
          </p></div>
        )}
        {pending.map((d) => (
          <div className="card" key={d.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <strong>{d.profiles?.full_name ?? d.email}</strong>
              <span className="badge">{KIND_LABEL[d.kind] ?? d.kind}</span>
            </div>
            <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 8px" }}>✉️ {d.email}</p>
            <form action={approveAndSend}>
              <input type="hidden" name="id" value={d.id} />
              <label>Subject</label>
              <input name="subject" defaultValue={d.subject} required />
              <label style={{ marginTop: 6 }}>Email text (edit freely before approving)</label>
              <textarea name="body" rows={8} defaultValue={d.body} required />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <SubmitButton className="btn small" savedLabel="✓ Sent">✅ Approve &amp; send</SubmitButton>
              </div>
            </form>
            <form action={rejectDraft} style={{ marginTop: 6 }}>
              <input type="hidden" name="id" value={d.id} />
              <SubmitButton className="btn small secondary">✖ Don&apos;t send</SubmitButton>
            </form>
          </div>
        ))}
      </div>

      <h3 style={{ margin: "26px 0 8px" }}>📜 Recent decisions</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {done.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing yet.</p></div>}
        {done.map((d) => (
          <div className="list-row" key={d.id}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title">{d.profiles?.full_name ?? d.email}</span>
              <p className="row-sub">
                {KIND_LABEL[d.kind] ?? d.kind} · {d.status === "sent" ? "✅ sent" : "✖ rejected"}
                {d.sent_at ? ` · ${new Date(d.sent_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
