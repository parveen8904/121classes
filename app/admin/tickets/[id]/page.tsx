import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../../_components/DeleteButton";
import {
  STATUS_LABEL, PRIORITY_LABEL, TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES,
  OPEN_STATUSES, staffList,
} from "@/lib/tickets";
import {
  assignTicket, addTicketNote, updateTicketStatus, setTicketFields, escalateTicket, deleteTicket,
} from "../actions";

export const dynamic = "force-dynamic";

const EVENT_ICON: Record<string, string> = {
  created: "🆕", note: "📝", call: "📞", status: "🔀", assign: "👤", escalate: "⚠️", email: "✉️",
};

export default async function TicketDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const svc = createServiceClient();
  const { data: t } = await svc.from("tickets").select("*").eq("id", params.id).maybeSingle();
  if (!t) notFound();

  const [{ data: events }, staff] = await Promise.all([
    svc.from("ticket_events").select("*").eq("ticket_id", params.id).order("created_at", { ascending: true }),
    staffList(svc),
  ]);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const isOpen = OPEN_STATUSES.includes(t.status as string);

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <p className="crumb"><Link href="/admin/tickets">← Tickets desk</Link></p>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="badge">🎫 {t.ref}</span>
        <h1 style={{ fontSize: "1.4rem", margin: 0 }}>{t.escalated ? "⚠️ " : ""}{t.title}</h1>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        {STATUS_LABEL[t.status as string]} · {PRIORITY_LABEL[t.priority as string]} · {t.source}
        {t.category ? ` · ${t.category}` : ""} · raised {new Date(t.created_at as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
      </p>

      {t.description && <div className="card" style={{ marginTop: 12 }}><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.description}</p></div>}

      {/* Student contact */}
      <div className="card" style={{ marginTop: 12 }}>
        <strong>👤 Student</strong>
        <p className="row-sub" style={{ marginTop: 6 }}>
          {t.student_name || "—"}
          {t.student_phone ? ` · 📞 ${t.student_phone}` : ""}
          {t.student_email ? ` · ✉️ ${t.student_email}` : ""}
        </p>
        {t.student_phone && <a className="btn small" href={`tel:${t.student_phone}`}>📞 Call now</a>}
      </div>

      {/* Assign + status + escalate */}
      <div className="card" style={{ marginTop: 12, display: "grid", gap: 14 }}>
        <form action={assignTicket} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={t.id as string} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Assigned to (who will call)</label>
            <select name="assigned_to" defaultValue={(t.assigned_to as string) ?? ""}>
              <option value="">— unassigned —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <SubmitButton className="btn small" savedLabel="✓ Saved">Assign</SubmitButton>
        </form>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <span style={{ fontSize: ".85rem", fontWeight: 700 }}>Status:</span>
          {TICKET_STATUSES.map((s) => (
            <form key={s} action={updateTicketStatus} style={{ margin: 0 }}>
              <input type="hidden" name="id" value={t.id as string} />
              <input type="hidden" name="status" value={s} />
              <button className={`btn small ${t.status === s ? "" : "secondary"}`} type="submit">{STATUS_LABEL[s]}</button>
            </form>
          ))}
        </div>

        {isOpen && !t.escalated && (
          <form action={escalateTicket} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={t.id as string} />
            <div style={{ flex: 1, minWidth: 200 }}><label>Escalate (can&apos;t resolve it)</label><input name="body" placeholder="Why it needs escalation…" /></div>
            <SubmitButton className="btn small secondary">⚠️ Escalate now</SubmitButton>
          </form>
        )}
      </div>

      {/* Activity log */}
      <h2 className="admin-section-title" style={{ marginTop: 22 }}>🧾 Activity</h2>
      <div className="card" style={{ marginTop: 10 }}>
        <form action={addTicketNote} style={{ display: "grid", gap: 8 }}>
          <input type="hidden" name="id" value={t.id as string} />
          <textarea name="body" rows={2} placeholder="Add a note or log what happened on the call…" required />
          <div style={{ display: "flex", gap: 8 }}>
            <SubmitButton className="btn small" name="kind" value="call" savedLabel="✓ Logged">📞 Log a call</SubmitButton>
            <SubmitButton className="btn small secondary" name="kind" value="note" savedLabel="✓ Added">📝 Add note</SubmitButton>
          </div>
        </form>

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {(events ?? []).length === 0 && <span className="muted" style={{ fontSize: ".85rem" }}>No activity yet.</span>}
          {(events ?? []).slice().reverse().map((e) => (
            <div key={e.id as string} style={{ borderLeft: "3px solid var(--border)", paddingLeft: 10 }}>
              <p style={{ margin: 0, fontSize: ".88rem" }}>
                {EVENT_ICON[e.kind as string] ?? "•"} {e.body}
              </p>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: ".76rem" }}>
                {e.author_name || "System"} · {new Date(e.created_at as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Edit details */}
      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>✏️ Edit ticket details</summary>
        <form action={setTicketFields} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={t.id as string} />
          <label>Title</label>
          <input name="title" defaultValue={t.title as string} />
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 6 }}>
            <div><label>Priority</label><select name="priority" defaultValue={t.priority as string}>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></div>
            <div><label>Category</label><select name="category" defaultValue={(t.category as string) ?? ""}><option value="">— none —</option>{TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 6 }}>
            <div><label>Student name</label><input name="student_name" defaultValue={(t.student_name as string) ?? ""} /></div>
            <div><label>Phone</label><input name="student_phone" defaultValue={(t.student_phone as string) ?? ""} /></div>
            <div><label>Email</label><input name="student_email" type="email" defaultValue={(t.student_email as string) ?? ""} /></div>
          </div>
          <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 10 }}>Save details</SubmitButton>
        </form>
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <DeleteButton action={deleteTicket} id={t.id as string} message="Delete this ticket permanently?" />
        </div>
      </details>
    </section>
  );
}
