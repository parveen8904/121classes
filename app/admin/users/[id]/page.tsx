import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../../_components/AdminHero";
import { updateUser, sendSetPasswordEmail, adminSetPassword } from "../actions";
import { ADMIN_AREAS } from "@/lib/adminAccess";

function fmt(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type SubRow = {
  id: string;
  status: string;
  ends_at: string | null;
  channel: string;
  courses: { title: string } | null;
  subjects: { title: string } | null;
  plans: { tier: string } | null;
};

export default async function UserDetail(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ pwset?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = createClient();
  const { data: u } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, phone, role, permissions, target_attempt, created_at, address_line1, address_line2, city, state, pincode, gstin, business_name",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!u) notFound();

  const { data: subsData } = await supabase
    .from("subscriptions")
    .select("id, status, ends_at, channel, courses(title), subjects(title), plans(tier)")
    .eq("student_id", u.id)
    .order("created_at", { ascending: false });
  const subs = (subsData ?? []) as unknown as SubRow[];

  // Watch progress + activity log (what the student is doing — for planning).
  const { data: watch } = await supabase
    .from("class_watch")
    .select("video_seconds, real_seconds, duration_seconds, completed, last_watched_at, sections(title, topics(title))")
    .eq("student_id", u.id)
    .order("last_watched_at", { ascending: false })
    .limit(60);
  const { data: activity } = await supabase
    .from("student_activity")
    .select("kind, detail, created_at, sections(title)")
    .eq("student_id", u.id)
    .order("created_at", { ascending: false })
    .limit(40);
  const fmtSecs = (s: number) => {
    const m = Math.round((s || 0) / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const fmtWhen = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const ACT_LABEL: Record<string, string> = { class_open: "▶️ Opened a class", class_complete: "✅ Finished a class", test_submitted: "🧠 Gave a test", doubt: "💬 Asked a doubt", plan_built: "🗓️ Built a plan" };
  type WatchRow = { video_seconds: number; real_seconds: number; duration_seconds: number; completed: boolean; last_watched_at: string; sections: { title: string; topics: { title: string } | null } | null };
  type ActRow = { kind: string; detail: Record<string, unknown> | null; created_at: string; sections: { title: string } | null };
  const watchRows = (watch ?? []) as unknown as WatchRow[];
  const actRows = (activity ?? []) as unknown as ActRow[];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero
        badge="👤 User"
        title={u.full_name || u.email || "User"}
        subtitle={`${u.email ?? u.phone ?? ""} · joined ${fmt(u.created_at)} · role: ${u.role}`}
        back={{ href: "/admin/users", label: "Users" }}
      />

      {searchParams.pwset === "1" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Password set for this user.</div>}

      {/* Password rescue tools */}
      <details style={{ marginTop: 18 }}>
        <summary className="btn small secondary as-btn">🔑 Password help</summary>
        <div className="form-card" style={{ marginTop: 10 }}>
          <h3 style={{ marginTop: 0 }}>Reset this user&apos;s password</h3>
          {u.email ? (
            <>
              <form action={sendSetPasswordEmail} style={{ marginBottom: 14 }}>
                <input type="hidden" name="email" value={u.email} />
                <input type="hidden" name="name" value={u.full_name ?? ""} />
                <p className="muted" style={{ fontSize: ".85rem", marginBottom: 8 }}>
                  Email them a link to set their own password (recommended).
                </p>
                <button className="btn small" type="submit">📧 Send set-password email</button>
              </form>
              <form action={adminSetPassword}>
                <input type="hidden" name="id" value={u.id} />
                <p className="muted" style={{ fontSize: ".85rem", marginBottom: 8 }}>
                  Or set a password directly (tell them in person):
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input name="password" type="text" placeholder="New password (min 6)" style={{ marginBottom: 0, maxWidth: 240 }} />
                  <button className="btn small secondary" type="submit">Set password</button>
                </div>
              </form>
            </>
          ) : (
            <p className="muted">This user has no email on file.</p>
          )}
        </div>
      </details>

      <form action={updateUser} style={{ marginTop: 16 }}>
        <input type="hidden" name="id" value={u.id} />

        <div className="form-card">
          <h3>✏️ Profile</h3>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Full name</label>
              <input name="full_name" defaultValue={u.full_name ?? ""} />
            </div>
            <div>
              <label>Phone</label>
              <input name="phone" defaultValue={u.phone ?? ""} />
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Target attempt</label>
              <input name="target_attempt" defaultValue={u.target_attempt ?? ""} placeholder="e.g. MAY_2026" />
            </div>
            <div>
              <label>Role</label>
              <select name="role" defaultValue={u.role}>
                <option value="student">🎓 Student</option>
                <option value="operator">🧑‍💼 Operator (staff)</option>
                <option value="faculty">👩‍🏫 Faculty</option>
                <option value="admin">🛠️ Admin (full access)</option>
              </select>
            </div>
          </div>
          <p className="muted" style={{ fontSize: ".8rem" }}>Email is the login identity and can&apos;t be changed here.</p>

          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
            <strong>🔑 Rights (for Operator / Faculty)</strong>
            <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 10px" }}>
              Tick the admin areas this person may manage. Admins always have everything; students have none.
              Untick everything to remove their admin access.
            </p>
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
              {ADMIN_AREAS.map((a) => (
                <label key={a.key} className="remember" style={{ margin: 0 }}>
                  <input type="checkbox" name="perm" value={a.key} defaultChecked={((u.permissions as string[]) ?? []).includes(a.key)} /> {a.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="form-card" style={{ marginTop: 16 }}>
          <h3>📦 Shipping address</h3>
          <label>Address line 1</label>
          <input name="address_line1" defaultValue={u.address_line1 ?? ""} />
          <label>Address line 2</label>
          <input name="address_line2" defaultValue={u.address_line2 ?? ""} />
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div>
              <label>City</label>
              <input name="city" defaultValue={u.city ?? ""} />
            </div>
            <div>
              <label>State</label>
              <input name="state" defaultValue={u.state ?? ""} />
            </div>
            <div>
              <label>PIN</label>
              <input name="pincode" defaultValue={u.pincode ?? ""} />
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>GSTIN</label>
              <input name="gstin" defaultValue={u.gstin ?? ""} />
            </div>
            <div>
              <label>Business name</label>
              <input name="business_name" defaultValue={u.business_name ?? ""} />
            </div>
          </div>
        </div>

        <button className="btn" type="submit" style={{ marginTop: 18 }}>
          Save user
        </button>
      </form>

      <h2 className="admin-section-title">📺 Watch progress ({watchRows.length})</h2>
      <p className="muted" style={{ fontSize: ".85rem" }}>Per class: how far through the video vs the real time spent. A real time much bigger than the video length means breaks / gaps.</p>
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {watchRows.length > 0 ? watchRows.map((w, i) => {
          const pct = w.duration_seconds > 0 ? Math.min(100, Math.round((w.video_seconds / w.duration_seconds) * 100)) : 0;
          const gap = w.real_seconds - w.video_seconds;
          return (
            <div className="card" key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <strong>{w.completed ? "✅ " : ""}{w.sections?.title ?? "Class"}</strong>
                <span className="muted" style={{ fontSize: ".78rem" }}>{w.sections?.topics?.title ? ` · ${w.sections.topics.title}` : ""} · last {fmtWhen(w.last_watched_at)}</span>
              </div>
              <span className="muted" style={{ fontSize: ".82rem", whiteSpace: "nowrap" }}>
                ▶️ {pct}% ({fmtSecs(w.video_seconds)}/{fmtSecs(w.duration_seconds)}) · ⏱️ spent {fmtSecs(w.real_seconds)}{gap > 120 ? ` · 🐢 +${fmtSecs(gap)} gaps` : ""}
              </span>
            </div>
          );
        }) : <p className="muted">No classes watched yet.</p>}
      </div>

      <h2 className="admin-section-title">🧾 Activity log ({actRows.length})</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
        {actRows.length > 0 ? actRows.map((a, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: ".85rem", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
            <span>{ACT_LABEL[a.kind] ?? a.kind}{a.sections?.title ? ` — ${a.sections.title}` : ""}{a.detail && typeof a.detail.score !== "undefined" ? ` (${a.detail.score}/${a.detail.total})` : ""}</span>
            <span className="muted">{fmtWhen(a.created_at)}</span>
          </div>
        )) : <p className="muted">No activity yet.</p>}
      </div>

      <h2 className="admin-section-title">🎟️ Subscriptions</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {subs.length > 0 ? (
          subs.map((s) => (
            <div className="list-row" key={s.id}>
              <div>
                <span className="row-title">📘 {s.courses?.title ?? "Course"}</span>
                <p className="row-sub">
                  {s.subjects?.title ?? "Whole course"} · {s.plans?.tier ?? "—"} · {s.status}
                  {s.status === "active" ? ` · expires ${fmt(s.ends_at)}` : ""} · {s.channel}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">No subscriptions. Grant access from the Enrolment page.</p>
          </div>
        )}
      </div>
    </section>
  );
}
