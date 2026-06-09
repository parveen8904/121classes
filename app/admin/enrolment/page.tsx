import { createClient } from "@/lib/supabase/server";
import { DURATIONS, durationLabel } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";
import { grantSubscription, bulkGrant, revokeSubscription, extendSubscription } from "./actions";

const TIERS = [
  { value: "bronze", label: "Bronze" },
  { value: "silver", label: "Silver" },
  { value: "gold", label: "Gold" },
];

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
  plans: { tier: string } | null;
};

export default async function EnrolmentPage({
  searchParams,
}: {
  searchParams: { granted?: string; missing?: string; error?: string };
}) {
  const supabase = createClient();

  const [{ data: courses }, { data: subs }] = await Promise.all([
    supabase.from("courses").select("id, title").order("order_index").order("title"),
    supabase
      .from("subscriptions")
      .select(
        "id, ends_at, status, auto_renew, channel, profiles(email, full_name), courses(title), plans(tier)",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const subscriptions = (subs ?? []) as unknown as SubRow[];
  const granted = searchParams.granted ? Number(searchParams.granted) : null;
  const missing = searchParams.missing ? searchParams.missing.split(",") : [];

  const CourseOptions = () => (
    <select name="course_id" required defaultValue="">
      <option value="" disabled>
        Select course…
      </option>
      {(courses ?? []).map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </select>
  );
  const TierOptions = () => (
    <select name="tier" defaultValue="bronze">
      {TIERS.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );
  const DurationOptions = () => (
    <select name="months" defaultValue="3">
      {DURATIONS.map((m) => (
        <option key={m} value={m}>
          {durationLabel(m)}
        </option>
      ))}
    </select>
  );

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🎟️ Enrolment"
        title="Enrolment"
        subtitle="Grant course access for free (no payment). Online checkout arrives with payments (Phase 5). 🚀"
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
          Please fill in email, course and tier.
        </div>
      )}
      {searchParams.error === "noplan" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          No active plan found for that tier. Check the Plans page.
        </div>
      )}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Grant to one student</h3>
          <form action={grantSubscription}>
            <label htmlFor="g-email">Student email</label>
            <input id="g-email" name="email" type="email" placeholder="student@example.com" required />
            <label>Course</label>
            <CourseOptions />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label>Tier</label>
                <TierOptions />
              </div>
              <div>
                <label>Duration</label>
                <DurationOptions />
              </div>
            </div>
            <button className="btn" type="submit">
              Grant access
            </button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Bulk grant (CSV / list)</h3>
          <form action={bulkGrant}>
            <label htmlFor="b-emails">Emails (comma, space or newline separated)</label>
            <textarea id="b-emails" name="emails" rows={4} placeholder="a@x.com, b@y.com…" required />
            <label>Course</label>
            <CourseOptions />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label>Tier</label>
                <TierOptions />
              </div>
              <div>
                <label>Duration</label>
                <DurationOptions />
              </div>
            </div>
            <button className="btn" type="submit">
              Grant to all
            </button>
          </form>
        </div>
      </div>

      <h2 style={{ margin: "36px 0 6px", fontSize: "1.2rem" }}>Recent subscriptions</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {subscriptions.length > 0 ? (
          subscriptions.map((s) => (
            <div
              className="card"
              key={s.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
            >
              <div>
                <strong>{s.profiles?.full_name || s.profiles?.email || "Unknown"}</strong>
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                  {s.courses?.title ?? "—"} · {s.plans?.tier ?? "—"} · {s.status}
                  {s.status === "active" ? ` · expires ${fmtDate(s.ends_at)}` : ""} · {s.channel}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
          <p className="muted">No subscriptions yet.</p>
        )}
      </div>
    </section>
  );
}
