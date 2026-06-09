import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return (
      <main className="narrow" style={{ paddingTop: 80 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.3rem", marginBottom: 8 }}>Admins only</h1>
          <p className="muted">
            Your account isn’t an admin. Set <code>role = &apos;admin&apos;</code> on your row
            in the <code>profiles</code> table (Supabase → Table editor) to access this area.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link className="btn secondary" href="/dashboard">
              Back to dashboard
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const panels = [
    ["Courses & content", "Create courses → subjects → topics → sections (Phase 2)."],
    ["Faculty", "Add faculty and assign them to subjects (Phase 2)."],
    ["Plans & pricing", "Bronze/Silver/Gold, durations, web vs app prices (Phase 5)."],
    ["Enrolment", "Manual + bulk CSV grants for any course/duration (Phase 4)."],
    ["Live classes", "Schedule Zoom webinars (Phase 6)."],
    ["Books & warehouse", "Catalogue + end-of-day dispatch email (Phase 5)."],
    ["Reporting", "Finance, student & warehouse emails (Phase 8)."],
  ];

  return (
    <main>
      <header className="topbar">
        <Link className="logo" href="/">
          121<span>Coaching</span>
        </Link>
        <Link className="muted" href="/dashboard">
          Student view
        </Link>
      </header>

      <section className="container" style={{ paddingTop: 40 }}>
        <span className="badge">Admin</span>
        <h1 style={{ margin: "14px 0 6px" }}>Admin panel</h1>
        <p className="muted">Signed in as {profile.full_name ?? user.email ?? user.phone}.</p>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
            marginTop: 28,
          }}
        >
          {panels.map(([title, desc]) => (
            <div className="card" key={title}>
              <h3>{title}</h3>
              <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
