import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";

const ROLE_EMOJI: Record<string, string> = { student: "🎓", admin: "🛠️", faculty: "👩‍🏫" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: { q?: string; role?: string };
}) {
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

      <form className="form-card" style={{ marginTop: 24 }}>
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
          <button className="btn" type="submit">
            Filter
          </button>
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
