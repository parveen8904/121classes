import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPassword from "./set-password";

export default async function Dashboard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, target_attempt")
    .eq("id", user.id)
    .single();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title")
    .eq("is_published", true)
    .order("order_index");

  return (
    <main>

      <section className="container" style={{ paddingTop: 40 }}>
        <span className="badge">🎓 Student dashboard</span>
        <h1 style={{ margin: "14px 0 6px" }}>
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""} 👋
        </h1>
        <p className="muted">
          {user.email ?? user.phone} · 🎯 Target attempt:{" "}
          {profile?.target_attempt ?? "not set"}
        </p>

        <div style={{ marginTop: 20 }}>
          <SetPassword />
        </div>

        <h2 style={{ margin: "32px 0 16px", fontSize: "1.2rem" }}>📚 Your courses</h2>
        {courses && courses.length > 0 ? (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
            {courses.map((c) => (
              <Link key={c.id} href={`/learn/${c.id}`} style={{ display: "block" }}>
                <div className="card" style={{ height: "100%" }}>
                  <h3>📘 {c.title}</h3>
                  <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
                    Open course → subjects, topics &amp; sections →
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card">
            <p className="muted">
              📭 No courses published yet — once we add them, they appear here, filtered to your exam
              attempt. Hang tight! ✨
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
