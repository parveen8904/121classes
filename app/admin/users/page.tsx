import Link from "next/link";
import SubmitButton from "@/app/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import { addUsers, rescueFirstLogins } from "./actions";
import { createServiceClient } from "@/lib/supabase/service";

const ROLE_EMOJI: Record<string, string> = { student: "🎓", admin: "🛠️", faculty: "👩‍🏫" };

export default async function UsersPage(
  props: {
    searchParams: Promise<{ q?: string; role?: string; added?: string; invited?: string; failed?: string; rescued?: string; rescueleft?: string; rescueerr?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const q = (searchParams.q ?? "").trim();

  // How many students have never once signed in — the number that mattered
  // most and that nothing on this page was showing.
  let stuck = 0;
  try {
    const { data } = await createServiceClient().rpc("students_never_signed_in", { max_rows: 1000 });
    stuck = ((data ?? []) as unknown[]).length;
  } catch { /* never let a count break the page */ }
  const role = searchParams.role ?? "";

  let query = supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, target_attempt, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  if (role && ["student", "admin", "faculty"].includes(role)) query = query.eq("role", role);

  const { data: users } = await query;

  // Level (Final / Inter / both) per user — from their course shelf. MUST use
  // the service client: my_courses RLS is own-rows-only, so the admin's user
  // client silently reads nothing for other students.
  const levelByUser = new Map<string, string>();
  const ids = (users ?? []).map((u) => u.id as string);
  if (ids.length) {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const { data: mc } = await createServiceClient()
      .from("my_courses")
      .select("student_id, courses(title)")
      .in("student_id", ids);
    for (const r of mc ?? []) {
      const t = ((r as { courses?: { title?: string } | null }).courses?.title ?? "").toLowerCase();
      const lvl = t.includes("final") ? "Final" : t.includes("inter") ? "Inter" : "";
      if (!lvl) continue;
      const cur = levelByUser.get(r.student_id as string);
      levelByUser.set(r.student_id as string, cur && cur !== lvl ? "Final + Inter" : (cur ?? lvl) === lvl ? lvl : "Final + Inter");
    }
  }

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      {/* Students who have an account and have never once got into it. */}
      {stuck > 0 && (
        <div className="notice err" style={{ marginTop: 16 }}>
          <strong>⚠️ {stuck} student{stuck === 1 ? " has" : "s have"} never been able to log in.</strong>
          <p style={{ fontSize: ".88rem", margin: "6px 0 10px" }}>
            They were emailed a &ldquo;Set my password&rdquo; button. That is a single-use link that expires within
            the hour — a student who opens the email next morning gets &ldquo;link expired&rdquo; and gives up.
            Sending them a <strong>password</strong> instead fixes it: it does not expire, it works on any device,
            and it can be read out over the phone. They can change it later from their dashboard.
          </p>
          <form action={rescueFirstLogins}>
            <SubmitButton className="btn small" savedLabel="Sending…">
              📧 Send working passwords to the next 100
            </SubmitButton>
          </form>
        </div>
      )}
      {searchParams.rescued && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Sent to {searchParams.rescued} student(s). {searchParams.rescueleft ?? 0} still to go — press again.
          {searchParams.rescueerr ? ` First problem: ${searchParams.rescueerr}` : ""}
        </div>
      )}

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
                    {levelByUser.get(u.id as string) ? ` · 📘 ${levelByUser.get(u.id as string)}` : ""}
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
