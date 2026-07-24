import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GroupChat from "./GroupChat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group discussion — CA Parveen Sharma" };

export default async function DiscussPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/discuss");

  // Discuss is STAFF-ONLY (founder's call): students use Community instead.
  const { data: prof } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin" && prof?.role !== "faculty") redirect("/community");
  const { data: mine } = await supabase.from("my_subjects").select("subject_id").eq("student_id", user.id);
  const ids = (mine ?? []).map((r) => r.subject_id as string);

  let groups: { subjectId: string; title: string }[] = [];
  if (ids.length) {
    const { data: subs } = await supabase.from("subjects").select("id, title, telegram_group_chat_id, discord_channel_id").in("id", ids);
    groups = (subs ?? [])
      .filter((s) => (s as { telegram_group_chat_id?: string | null }).telegram_group_chat_id || (s as { discord_channel_id?: string | null }).discord_channel_id)
      .map((s) => ({ subjectId: s.id as string, title: s.title as string }));
  }

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 40, maxWidth: 820 }}>
        <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <div className="learn-hero">
          <span className="badge">💬 Group discussion</span>
          <h1>Discuss with your batch</h1>
          <p className="meta">Chat with your subject group — synced live with Telegram, no Telegram account needed. Be respectful: ads, links, phone numbers &amp; abuse are removed automatically. 🤝</p>
        </div>
        <div style={{ marginTop: 16 }}>
          {groups.length ? (
            <GroupChat groups={groups} meId={user.id} meName={(prof?.full_name as string) || "You"} />
          ) : (
            <div className="card">
              <p className="muted">You&apos;re not in any subject group yet. Add a subject from your dashboard — once its group is set up, the chat appears here.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
