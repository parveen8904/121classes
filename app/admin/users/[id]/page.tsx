import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../../_components/AdminHero";
import { updateUser } from "../actions";

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

export default async function UserDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: u } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, phone, role, target_attempt, created_at, address_line1, address_line2, city, state, pincode, gstin, business_name",
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

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero
        badge="👤 User"
        title={u.full_name || u.email || "User"}
        subtitle={`${u.email ?? u.phone ?? ""} · joined ${fmt(u.created_at)} · role: ${u.role}`}
        back={{ href: "/admin/users", label: "Users" }}
      />

      <form action={updateUser} style={{ marginTop: 24 }}>
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
                <option value="faculty">👩‍🏫 Faculty</option>
                <option value="admin">🛠️ Admin</option>
              </select>
            </div>
          </div>
          <p className="muted" style={{ fontSize: ".8rem" }}>Email is the login identity and can&apos;t be changed here.</p>
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
