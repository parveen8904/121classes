import { createClient } from "@/lib/supabase/server";
import SubmitButton from "@/app/components/SubmitButton";
import { DURATIONS, durationLabel } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";
import EnrolForm from "./EnrolForm";
import { grantSubscription, bulkGrant, revokeSubscription, extendSubscription, blockSubscription, restoreSubscription } from "./actions";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

type SubRow = {
  id: string;
  ends_at: string | null;
  status: string;
  blocked_reason?: string | null;
  auto_renew: boolean;
  channel: string;
  profiles: { email: string | null; full_name: string | null } | null;
  courses: { title: string } | null;
  subjects: { title: string } | null;
  plans: { tier: string } | null;
};
type CourseRow = { id: string; title: string; subjects: { id: string; title: string }[] };

export default async function EnrolmentPage(
  props: {
    searchParams: Promise<{ granted?: string; missing?: string; error?: string; dupe?: string; until?: string; tier?: string; months?: string; course?: string; blocked?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();

  const [{ data: courses }, { data: subs }] = await Promise.all([
    supabase.from("courses").select("id, title, subjects(id, title)").order("order_index").order("title"),
    supabase
      .from("subscriptions")
      .select(
        "id, ends_at, status, auto_renew, channel, blocked_reason, profiles(email, full_name), courses(title), subjects(title), plans(tier)",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const courseList = (courses ?? []) as unknown as CourseRow[];
  const subscriptions = (subs ?? []) as unknown as SubRow[];
  // Bulk grants come back with a COUNT, a single grant with the student's
  // email — so the confirmation can name who got what instead of just ticking.
  const grantedRaw = searchParams.granted ?? "";
  const grantedCount = grantedRaw && /^\d+$/.test(grantedRaw) ? Number(grantedRaw) : null;
  const grantedEmail = grantedRaw && !/^\d+$/.test(grantedRaw) ? grantedRaw : null;
  const granted = grantedRaw ? 1 : null;
  const missing = searchParams.missing ? searchParams.missing.split(",") : [];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🎟️ Enrolment"
        title="Enrolment"
        subtitle="Grant access by course & subject (free). Online checkout arrives with payments (Phase 5). 🚀"
        back={{ href: "/admin", label: "Admin" }}
      />

      {grantedEmail && (
        <div className="notice ok" style={{ marginTop: 16, fontSize: ".95rem" }}>
          ✅ <strong>Done.</strong> {searchParams.course || "Access"}
          {searchParams.tier ? ` · ${searchParams.tier}` : ""}
          {searchParams.months ? ` · ${searchParams.months} month(s)` : ""} granted to <strong>{grantedEmail}</strong>,
          and they have been emailed. It appears in the list below.
        </div>
      )}
      {grantedCount !== null && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Granted {grantedCount} subscription{grantedCount === 1 ? "" : "s"}.
          {missing.length > 0 && <> Not found (no account yet): {missing.join(", ")}.</>}
        </div>
      )}
      {searchParams.dupe && (
        <div className="notice err" style={{ marginTop: 16, fontSize: ".95rem" }}>
          ⚠️ <strong>Subscription already added.</strong> {searchParams.dupe} already has an active subscription for
          that course and subject{searchParams.until ? <>, running until <strong>{searchParams.until}</strong></> : null}.
          Nothing was changed. To extend it, use <strong>Extend</strong> on the row below.
        </div>
      )}
      {searchParams.blocked && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          🚫 Subscription blocked — the student loses access immediately. Use <strong>Restore</strong> to undo.
        </div>
      )}
      {searchParams.missing && granted === null && (
        <div className="notice err" style={{ marginTop: 16 }}>
          No account found for {searchParams.missing}. The student must sign up first.
        </div>
      )}
      {searchParams.error === "missing" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          Please fill in email, course, subject and tier.
        </div>
      )}
      {searchParams.error === "noplan" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          No active plan found for that tier. Check the Plans page.
        </div>
      )}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 24 }}>
        <div className="form-card">
          <h3>➕ Grant to one student</h3>
          <EnrolForm courses={courseList} action={grantSubscription} mode="single" />
        </div>
        <div className="form-card">
          <h3>👥 Bulk grant (CSV / list)</h3>
          <EnrolForm courses={courseList} action={bulkGrant} mode="bulk" />
        </div>
      </div>

      <h2 className="admin-section-title">🎫 Recent subscriptions</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {subscriptions.length > 0 ? (
          subscriptions.map((s) => (
            <div className="list-row" key={s.id}>
              <div>
                <span className="row-title">{s.profiles?.full_name || s.profiles?.email || "Unknown"}</span>
                <p className="row-sub">
                  {s.courses?.title ?? "—"} · {s.subjects?.title ?? "Whole course"} · {s.plans?.tier ?? "—"} ·{" "}
                  {s.status === "blocked" ? "🚫 blocked" : s.status}
                  {s.status === "active" ? ` · expires ${fmtDate(s.ends_at)}` : ""} · {s.channel}
                  {s.status === "blocked" && s.blocked_reason ? ` · ${s.blocked_reason}` : ""}
                </p>
              </div>
              <div className="row-actions">
                <form action={extendSubscription} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                  <input type="hidden" name="id" value={s.id} />
                  <select name="months" defaultValue="3" style={{ marginBottom: 0, width: "auto" }}>
                    {DURATIONS.map((m) => (
                      <option key={m} value={m}>
                        +{durationLabel(m)}
                      </option>
                    ))}
                  </select>
                  <SubmitButton className="btn small secondary">
                    Extend
                  </SubmitButton>
                </form>
                {s.status === "blocked" && (
                  <form action={restoreSubscription} style={{ display: "inline", margin: 0 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn small" type="submit">↩️ Restore</button>
                  </form>
                )}
                {s.status === "active" && (
                  <form action={blockSubscription} style={{ display: "inline-flex", gap: 4, margin: 0 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input name="reason" placeholder="reason (refund, misconduct…)" style={{ width: 170, fontSize: ".78rem" }} />
                    <button className="btn small secondary" type="submit" title="Blocks access immediately; reversible">🚫 Block</button>
                  </form>
                )}
                {s.status === "active" && (
                  <form action={revokeSubscription} style={{ display: "inline", margin: 0 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <SubmitButton className="btn small secondary">
                      Revoke
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No subscriptions yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}
