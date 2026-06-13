import { createClient } from "@/lib/supabase/server";
import { DURATIONS, durationLabel } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";
import EnrolForm from "./EnrolForm";
import { grantSubscription, bulkGrant, revokeSubscription, extendSubscription } from "./actions";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

type SubRow = {
  id: string;
  ends_at: string | null;
  status: string;
  auto_renew: boolean;
  channel: string;
  profiles: { email: string | null; full_name: string | null } | null;
  courses: { title: string } | null;
  subjects: { title: string } | null;
  plans: { tier: string } | null;
};
type CourseRow = { id: string; title: string; subjects: { id: string; title: string }[] };

export default async function EnrolmentPage({
  searchParams,
}: {
  searchParams: { granted?: string; missing?: string; error?: string };
}) {
  const supabase = createClient();

  const [{ data: courses }, { data: subs }] = await Promise.all([
    supabase.from("courses").select("id, title, subjects(id, title)").order("order_index").order("title"),
    supabase
      .from("subscriptions")
      .select(
        "id, ends_at, status, auto_renew, channel, profiles(email, full_name), courses(title), subjects(title), plans(tier)",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const courseList = (courses ?? []) as unknown as CourseRow[];
  const subscriptions = (subs ?? []) as unknown as SubRow[];
  const granted = searchParams.granted ? Number(searchParams.granted) : null;
  const missing = searchParams.missing ? searchParams.missing.split(",") : [];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🎟️ Enrolment"
        title="Enrolment"
        subtitle="Grant access by course & subject (free). Online checkout arrives with payments (Phase 5). 🚀"
        back={{ href: "/admin", label: "Admin" }}
      />

      {granted !== null && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          Granted {granted} subscription{granted === 1 ? "" : "s"}.
          {missing.length > 0 && <> Not found (no account yet): {missing.join(", ")}.</>}
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
                  {s.status}
                  {s.status === "active" ? ` · expires ${fmtDate(s.ends_at)}` : ""} · {s.channel}
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
                  <button className="btn small secondary" type="submit">
                    Extend
                  </button>
                </form>
                {s.status === "active" && (
                  <form action={revokeSubscription} style={{ display: "inline", margin: 0 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn small secondary" type="submit">
                      Revoke
                    </button>
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
