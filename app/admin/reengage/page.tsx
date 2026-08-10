import { formatDate } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { approveAndSend, rejectDraft, sendReengagementNow } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Re-engagement — Admin" };

const KIND_LABEL: Record<string, string> = {
  never_started: "🆕 Signed up, never started (old, needs approving)",
  never_started_d3: "📩 Day 3 — sent automatically",
  never_started_d7: "📩 Day 7 — last note, sent automatically",
  inactive_14d: "😴 Inactive 14+ days",
};

type Draft = {
  id: string; kind: string; email: string; subject: string; body: string;
  status: string; created_at: string; sent_at: string | null;
  profiles: { full_name: string | null } | null;
};

export default async function ReengagePage(props: {
  searchParams: Promise<{ d3?: string; d7?: string }>;
}) {
  const sp = await props.searchParams;
  const svc = createServiceClient();
  const { data } = await svc
    .from("reengage_drafts")
    .select("id, kind, email, subject, body, status, created_at, sent_at, profiles:student_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  const drafts = ((data ?? []) as unknown as Draft[]);
  // LEFTOVERS FROM THE OLD DESIGN, NOT A QUEUE.
  //
  // These were written when a person had to approve each one, and 299 of them
  // were never approved. The ladder sends by itself now, so nothing will ever
  // act on these — but the page still headed them "waiting for your approval",
  // which read as 196 students waiting on him. They are history, and are shown
  // as history.
  const pending = drafts.filter((d) => d.status === "draft");
  const done = drafts.filter((d) => d.status !== "draft").slice(0, 50);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="🔁 Re-engagement"
        title="Bring-them-back emails"
        subtitle="Two emails, then we leave them alone: day 3 after signing up if they never opened a class, and one last note on day 7. Sent automatically. Anyone who opens a class drops out at once."
        back={{ href: "/admin", label: "Admin" }}
      />

      {(sp.d3 !== undefined || sp.d7 !== undefined) && (
        <div className="notice ok">
          Sent {sp.d3 ?? 0} day-3 note{sp.d3 === "1" ? "" : "s"} and {sp.d7 ?? 0} day-7 note{sp.d7 === "1" ? "" : "s"}.
          {sp.d3 === "0" && sp.d7 === "0" ? " Nobody was due — everyone has either started, or already had both." : ""}
        </div>
      )}

      {/* The same function the nightly round calls, so pressing this cannot
          give a different answer from waiting until tonight. Safe to press
          twice: nobody gets a rung of the ladder they have already had. */}
      <form action={sendReengagementNow} className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <strong>Send now to everyone due</strong>
          <div className="muted" style={{ fontSize: ".82rem" }}>
            Runs tonight&apos;s round immediately. Day 3 to those who signed up three days ago and never
            opened a class; day 7 to those who had the first note and still have not. Nobody else, and
            nobody twice.
          </div>
        </div>
        <SubmitButton className="btn" savedLabel="✓ Sent">Send now</SubmitButton>
      </form>

      <h3 style={{ margin: "22px 0 8px" }}>🗄️ Old drafts, never sent ({pending.length})</h3>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: -4, lineHeight: 1.6 }}>
        Written under the earlier arrangement, where each one waited for your approval — and none of these ever got
        it. Nothing acts on them now: the ladder sends by itself. They are kept only as a record. This is not a
        number of students waiting on you.
      </p>
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
                {d.sent_at ? ` · ${formatDate(d.sent_at)}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
