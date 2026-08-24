import { formatDate } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = {
  // One person's notifications.
  robots: { index: false, follow: true },
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/notifications" }, title: "Notifications" };

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  subject_title: string | null;
};

// EVERYTHING THIS STUDENT HAS BEEN TOLD.
//
// A push used to exist only for as long as it sat on the lock screen. This is
// the same list, kept — so a student who was asleep when a class went up can
// still find it, and one who has not installed the app yet sees it all anyway.
// That is why this lives on the website too, not just in the apps: today far
// more students have a browser than have the new app.

const ICON: Record<string, string> = {
  content: "📘",
  live_new: "📡",
  live_soon: "⏰",
  test: "📝",
  copy_checked: "✅",
  general: "📣",
};

function whenWords(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

export default async function NotificationsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notifications");

  const svc = createServiceClient();

  // What was unread BEFORE this visit — read first, because opening the page
  // is what marks them read. Ask afterwards and the answer is always zero.
  const { data: seenRow } = await svc
    .from("profiles").select("notifications_seen_at").eq("id", user.id).maybeSingle();
  const seenAt = (seenRow as { notifications_seen_at: string | null } | null)?.notifications_seen_at ?? null;

  const { data } = await svc.rpc("my_notifications", { p_user: user.id, p_limit: 100 });
  const rows = (data ?? []) as Row[];

  // Looking at the list is what marks it seen.
  await svc.from("profiles").update({ notifications_seen_at: new Date().toISOString() }).eq("id", user.id);

  const isNew = (r: Row) => !seenAt || new Date(r.created_at) > new Date(seenAt);
  const newCount = rows.filter(isNew).length;

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb"><Link prefetch={false} href="/dashboard">← Dashboard</Link></p>
        <span className="badge">🔔 Notifications</span>
        <h1 style={{ margin: "12px 0 6px" }}>What you have been told</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          {rows.length === 0
            ? "Nothing yet. When a class is added to one of your subjects, a live class is planned, or your copy comes back checked, it will appear here."
            : newCount > 0
              ? `${newCount} new since you last looked.`
              : "You are up to date."}
        </p>

        <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
          {rows.map((r) => {
            const body = (
              <div
                className="card"
                style={{
                  padding: "12px 14px",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  // A quiet marker, not a shout. New things are worth finding,
                  // not worth alarming anybody about.
                  borderLeft: isNew(r) ? "3px solid var(--accent)" : "3px solid transparent",
                }}
              >
                <span style={{ fontSize: "1.1rem", lineHeight: 1.4 }}>{ICON[r.kind] ?? "🔔"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: ".95rem" }}>{r.title}</strong>
                    {isNew(r) && (
                      <span className="badge" style={{ fontSize: ".62rem", padding: "1px 6px" }}>new</span>
                    )}
                  </div>
                  {r.body && (
                    <p style={{ margin: "3px 0 0", fontSize: ".88rem", lineHeight: 1.6 }}>{r.body}</p>
                  )}
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: ".76rem" }}>
                    {whenWords(r.created_at)}
                    {r.subject_title ? ` · ${r.subject_title}` : ""}
                  </p>
                </div>
              </div>
            );
            return r.link
              ? <Link key={r.id} href={r.link} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link>
              : <div key={r.id}>{body}</div>;
          })}
        </div>

        {rows.length > 0 && (
          <p className="muted" style={{ marginTop: 18, fontSize: ".8rem" }}>
            Only what applies to you: your subjects, your tests, and anything meant for everyone.
          </p>
        )}
      </section>
    </main>
  );
}
