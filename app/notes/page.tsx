import Link from "next/link";
import type { Metadata } from "next";
import { tryServiceClient } from "@/lib/supabase/service";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Free CA study material — past papers, RTPs and MTPs | CA Parveen Sharma",
  description:
    "Free PDF downloads for CA students: past exam papers, ICAI Revision Test Papers and Mock Test Papers, shared by CA Parveen Sharma. Sign in and download.",
  alternates: { canonical: "/notes" },
};

// The index Google crawls to find every free download. Each item has its own
// page on this domain rather than a bare link into storage.

const KIND_LABEL: Record<string, string> = {
  past_papers: "Past exam paper",
  rtp: "Revision Test Paper",
  mtp: "Mock Test Paper",
  question_bank: "Question bank",
  notes: "Notes",
  icai: "ICAI study material",
};

export default async function NotesIndex() {
  const svc = tryServiceClient();
  const { data } = svc
    ? await svc
        .from("repository_items")
        .select("title, kind, share_slug, share_summary")
        .eq("public_sample", true)
        .eq("is_active", true)
        .not("share_slug", "is", null)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] };
  const items = (data ?? []) as { title: string; kind: string; share_slug: string; share_summary: string | null }[];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <div className="learn-hero">
        <span className="badge">📄 Free downloads</span>
        <h1>Free CA study material</h1>
        <p className="meta">
          Past exam papers, ICAI Revision Test Papers and Mock Test Papers — free to download. Sign in once and take
          whatever you need.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <p className="muted" style={{ margin: 0 }}>Nothing shared yet — check back shortly.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
          {items.map((it) => (
            <Link className="list-row" key={it.share_slug} href={`/notes/${it.share_slug}`} style={{ textDecoration: "none" }}>
              <div style={{ minWidth: 0 }}>
                <span className="row-title">{it.title}</span>
                <p className="row-sub">
                  {KIND_LABEL[it.kind] ?? "Study material"}
                  {it.share_summary ? ` · ${it.share_summary.slice(0, 90)}` : ""}
                </p>
              </div>
              <div className="row-actions"><span className="btn small secondary">Open →</span></div>
            </Link>
          ))}
        </div>
      )}

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 20 }}>
        Looking for more? There is a <Link href="/free-planner">free day-by-day study planner</Link>, free chapter
        tests, and <Link href="/articles">free articles</Link> on the accounting standards.
      </p>
    </section>
  );
}
