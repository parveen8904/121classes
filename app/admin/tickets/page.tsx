import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import {
  STATUS_LABEL, PRIORITY_LABEL, OPEN_STATUSES, staffList,
  TICKET_PRIORITIES, TICKET_SOURCES, TICKET_CATEGORIES,
} from "@/lib/tickets";
import { createTicketAdmin } from "./actions";

export const dynamic = "force-dynamic";

type Ticket = {
  id: string; ref: string; title: string; status: string; priority: string;
  source: string; student_name: string | null; student_phone: string | null;
  assigned_to: string | null; escalated: boolean; created_at: string; escalate_at: string | null;
};

const TABS = [
  { key: "open", label: "🔵 Open" },
  { key: "mine_unassigned", label: "🆕 Unassigned" },
  { key: "resolved", label: "✅ Resolved" },
  { key: "closed", label: "⚫ Closed" },
  { key: "all", label: "All" },
];

export default async function TicketsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const svc = createServiceClient();
  const tab = searchParams.tab || "open";

  let q = svc.from("tickets").select("id, ref, title, status, priority, source, student_name, student_phone, assigned_to, escalated, created_at, escalate_at").order("created_at", { ascending: false }).limit(300);
  if (tab === "open") q = q.in("status", OPEN_STATUSES);
  else if (tab === "mine_unassigned") q = q.in("status", OPEN_STATUSES).is("assigned_to", null);
  else if (tab === "resolved") q = q.eq("status", "resolved");
  else if (tab === "closed") q = q.eq("status", "closed");

  const [{ data: tickets }, staff] = await Promise.all([q, staffList(svc)]);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const rows = (tickets ?? []) as Ticket[];

  // Counts for the tab badges.
  const { data: openRows } = await svc.from("tickets").select("assigned_to").in("status", OPEN_STATUSES);
  const openCount = (openRows ?? []).length;
  const unassignedCount = (openRows ?? []).filter((r) => !r.assigned_to).length;

  const now = Date.now();

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🎫 Support tickets"
        title="Tickets desk"
        subtitle="Every website & phone issue in one place — assign it to someone who calls the student, log the activity, and resolve. Overdue tickets escalate automatically. 📞"
        back={{ href: "/admin", label: "Admin" }}
      />

      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ Log a ticket (phone / manual)</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <h3>📞 Log a new ticket</h3>
          <form action={createTicketAdmin}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr 1fr" }}>
              <div><label>What's the issue?</label><input name="title" placeholder="e.g. Can't access FR classes after payment" required /></div>
              <div>
                <label>Priority</label>
                <select name="priority" defaultValue="normal">{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
              </div>
              <div>
                <label>Assign to</label>
                <select name="assigned_to" defaultValue=""><option value="">— unassigned —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </div>
            </div>
            <label style={{ marginTop: 8 }}>Details</label>
            <textarea name="description" rows={3} placeholder="What the student told you…" />
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr 1fr", marginTop: 4 }}>
              <div><label>Student name</label><input name="student_name" /></div>
              <div><label>Phone</label><input name="student_phone" placeholder="10-digit" /></div>
              <div><label>Email</label><input name="student_email" type="email" /></div>
              <div>
                <label>Source</label>
                <select name="source" defaultValue="phone">{TICKET_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <label>Category</label>
              <select name="category" defaultValue=""><option value="">— none —</option>{TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <SubmitButton className="btn" style={{ marginTop: 10 }}>Create ticket</SubmitButton>
          </form>
        </div>
      </details>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/tickets?tab=${t.key}`} className={`btn small ${tab === t.key ? "" : "secondary"}`}>
            {t.label}
            {t.key === "open" ? ` (${openCount})` : t.key === "mine_unassigned" ? ` (${unassignedCount})` : ""}
          </Link>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {rows.length > 0 ? rows.map((t) => {
          const overdue = t.escalate_at && OPEN_STATUSES.includes(t.status) && new Date(t.escalate_at).getTime() < now;
          return (
            <Link key={t.id} href={`/admin/tickets/${t.id}`} className="list-row" style={{ textDecoration: "none", color: "inherit" }}>
              <div>
                <span className="row-title">
                  {t.escalated ? "⚠️ " : ""}🎫 {t.ref} · {t.title}
                </span>
                <p className="row-sub">
                  {STATUS_LABEL[t.status] ?? t.status} · {PRIORITY_LABEL[t.priority] ?? t.priority}
                  {t.source ? ` · ${t.source}` : ""}
                  {t.assigned_to ? ` · 👤 ${staffName.get(t.assigned_to) ?? "assigned"}` : " · 🆕 unassigned"}
                  {t.student_phone ? ` · 📞 ${t.student_phone}` : ""}
                  {overdue && !t.escalated ? " · ⏰ overdue" : ""}
                  {` · ${new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                </p>
              </div>
              <span className="btn small secondary">Open →</span>
            </Link>
          );
        }) : (
          <div className="card"><p className="muted">📭 No tickets here.</p></div>
        )}
      </div>
    </section>
  );
}
