import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import OfflineManager from "./OfflineManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offline downloads — Admin" };

// Prepare every class for offline download (encrypted 720p copy on R2).
export default async function OfflinePage() {
  const svc = createServiceClient();
  const [{ data: classes }, { data: jobs }, { data: subjects }, { data: topics }] = await Promise.all([
    svc.from("sections").select("id, title, topic_id, config").eq("type", "full_class_video").eq("is_published", true).order("order_index"),
    svc.from("offline_jobs").select("section_id, status, bytes_total, bytes_done, error"),
    svc.from("subjects").select("id, title"),
    svc.from("topics").select("id, subject_id"),
  ]);
  const subjName = new Map((subjects ?? []).map((s) => [s.id as string, s.title as string]));
  const topicSubj = new Map((topics ?? []).map((t) => [t.id as string, t.subject_id as string]));
  const jobBySection = new Map((jobs ?? []).map((j) => [j.section_id as string, j]));

  const rows = (classes ?? [])
    .filter((c) => ((c.config ?? {}) as Record<string, string>).bunny_video_id)
    .map((c) => {
      const j = jobBySection.get(c.id as string);
      const total = Number(j?.bytes_total) || 0;
      const cfg = (c.config ?? {}) as Record<string, string>;
      return {
        sectionId: c.id as string,
        title: `${cfg.class_no ? `Class ${cfg.class_no} · ` : ""}${c.title as string}`,
        subject: subjName.get(topicSubj.get(c.topic_id as string) ?? "") ?? "",
        status: (j?.status as string) ?? "none",
        pct: total ? Math.floor(((Number(j?.bytes_done) || 0) / total) * 100) : 0,
        error: (j?.error as string) ?? null,
      };
    });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📥 Offline downloads"
        title="Prepare classes for offline"
        subtitle="Each prepared class gets an encrypted 720p copy (~1.5–2 GB) that students can download INSIDE the apps and watch without internet — the file is useless outside the app. After your first class succeeds, this becomes FULLY AUTOMATIC: every newly published class is prepared by the hourly background run with no steps needed. Use the buttons only to jump the queue."
        back={{ href: "/admin", label: "Admin" }}
      />
      <OfflineManager initial={rows} />
    </section>
  );
}
