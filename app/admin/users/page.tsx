import Link from "next/link";
import SubmitButton from "@/app/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import { addUsers } from "./actions";

const ROLE_EMOJI: Record<string, string> = { student: "🎓", admin: "🛠️", faculty: "👩‍🏫" };

export default async function UsersPage(
  props: {
    searchParams: Promise<{ q?: string; role?: string; added?: string; invited?: string; failed?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const q = (searchParams.q ?? "").trim();
  const role = searchParams.role ?? "";

  let query = supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, target_attempt, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  if (role && ["student", "admin", "faculty"].includes(role)) query = query.eq("role", role);

  const { data: users } = await query;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="👥 Users"
        title="Users"
        subtitle="View, edit and manage every account — change roles, attempts and contact details. 🔧"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.added !== undefined && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Created {searchParams.added} user(s), emailed {searchParams.invited ?? 0} a set-password link
          {Number(searchParams.failed ?? 0) > 0 ? `, ${searchParams.failed} skipped (already exist / bad email)` : ""}.
        </div>
      )}
      {searchParams.added === undefined && searchParams.invited === "1" && (
        <div className="notice ok" style={{ marginTop: 16 }}>✅ Set-password email sent.</div>
      )}

      {/* Add users — collapsed, top-right */}
      <details style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ Add users</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <h3>➕ Add one or many users</h3>
          <p className="muted" style={{ fontSize: ".84rem", marginBottom: 10 }}>
            One per line as <strong>Name, email</strong> (e.g. <code>Riya Sharma, riya@example.com</code>). No verification needed —
            each person is emailed a link to set their own password, then logs in with email + password.
          </p>
          <form action={addUsers}>
            <label>Role for these users</label>
            <select name="role" defaultValue="student">
              <option value="student">🎓 Student</option>
              <option value="faculty">👩‍🏫 Faculty</option>
              <option value="admin">🛠️ Admin</option>
            </select>
            <label style={{ marginTop: 10 }}>Users (one per line)</label>
            <textarea name="bulk" rows={6} placeholder={"Riya Sharma, riya@example.com\nAmit Verma, amit@example.com"} required />
            <SubmitButton className="btn" style={{ marginTop: 8 }}>Create &amp; email set-password links</SubmitButton>
          </form>
        </div>
      </details>

      <form className="form-card" style={{ marginTop: 16 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr auto", alignItems: "end" }}>
          <div>
            <label htmlFor="q">Search (name, email, phone)</label>
            <input id="q" name="q" defaultValue={q} placeholder="Type to search…" style={{ marginBottom: 0 }} />
          </div>
          <div>
            <label htmlFor="role">Role</label>
            <select id="role" name="role" defaultValue={role} style={{ marginBottom: 0 }}>
              <option value="">All roles</option>
              <option value="student">🎓 Students</option>
              <option value="faculty">👩‍🏫 Faculty</option>
              <option value="admin">🛠️ Admins</option>
            </select>
          </div>
          <SubmitButton className="btn">
            Filter
          </SubmitButton>
        </div>
      </form>

      <p className="muted" style={{ marginTop: 14, fontSize: ".85rem" }}>
        {users?.length ?? 0} user{(users?.length ?? 0) === 1 ? "" : "s"}
        {(q || role) && (
          <>
            {" "}
            · <Link href="/admin/users">clear filters</Link>
          </>
        )}
      </p>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {users && users.length > 0 ? (
          users.map((u) => (
            <Link key={u.id} href={`/admin/users/${u.id}`} style={{ display: "block" }}>
              <div className="list-row">
                <div>
                  <span className="row-title">
                    {ROLE_EMOJI[u.role] ?? "👤"} {u.full_name || "(no name)"}
                  </span>
                  <p className="row-sub">
                    {u.email ?? u.phone ?? "—"} · {u.role}
                    {u.target_attempt ? ` · 🎯 ${u.target_attempt}` : ""}
                  </p>
                </div>
                <span className="btn small secondary">Manage →</span>
              </div>
            </Link>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No users match your search.</p>
          </div>
        )}
      </div>
    </section>
  );
}
