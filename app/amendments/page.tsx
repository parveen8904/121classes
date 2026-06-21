import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bunnyEmbedUrl } from "@/lib/bunny";
import { videoEmbedSrc } from "@/app/learn/_lib/media";
import AmendmentsView, { type AmendItem } from "./AmendmentsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Amendments & Updates — CA Parveen Sharma" };

type Row = {
  id: string;
  title: string;
  body: string | null;
  discussion: string | null;
  subject_id: string | null;
  topic_id: string | null;
  bunny_video_id: string | null;
  bunny_drm: string | null;
  youtube_url: string | null;
  embed_url: string | null;
  notes_hand_url: string | null;
  valid_from_attempt: string | null;
  valid_to_attempt: string | null;
};

export default async function AmendmentsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/amendments");

  const { data: prof } = await supabase.from("profiles").select("target_attempt").eq("id", user.id).maybeSingle();
  const myAttempt = (prof?.target_attempt || "").replace(/_/g, " ").trim();

  const [{ data: rows }, { data: subjects }, { data: topics }] = await Promise.all([
    supabase.from("amendments").select("*").eq("is_published", true).order("valid_from_attempt").order("order_index"),
    supabase.from("subjects").select("id, title"),
    supabase.from("topics").select("id, title"),
  ]);
  const subjName = new Map((subjects ?? []).map((s) => [s.id, s.title]));
  const topicName = new Map((topics ?? []).map((t) => [t.id, t.title]));

  const items: AmendItem[] = ((rows ?? []) as Row[]).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    discussion: a.discussion,
    validFrom: a.valid_from_attempt,
    validTo: a.valid_to_attempt,
    notesHandUrl: a.notes_hand_url,
    videoSrc: a.bunny_video_id
      ? bunnyEmbedUrl(a.bunny_video_id, a.bunny_drm !== "off")
      : videoEmbedSrc({ youtube_url: a.youtube_url ?? undefined, embed_url: a.embed_url ?? undefined } as Record<string, unknown>),
    tag: a.topic_id ? (topicName.get(a.topic_id) ?? null) : a.subject_id ? (subjName.get(a.subject_id) ?? null) : null,
  }));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <div className="learn-hero">
        <span className="badge">📜 Amendments &amp; updates</span>
        <h1>Amendments &amp; updates</h1>
        <p className="meta">Everything that applies to your attempt — amendments, updates, the video and notes. Change the attempt to see another batch.</p>
      </div>
      <div style={{ marginTop: 20 }}>
        <AmendmentsView items={items} defaultAttempt={myAttempt} />
      </div>
    </section>
  );
}
