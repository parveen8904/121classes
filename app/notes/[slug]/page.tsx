import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { tryServiceClient } from "@/lib/supabase/service";

export const revalidate = 3600;

// A page of our own for every free PDF.
//
// The file itself sits in storage on a supabase.co address, so a link straight
// to it earns Google credit for supabase.co. This page is on
// caparveensharma.com, carries the title and description Google reads, and
// holds the download button — so the ranking, and the student, arrive here.
// The page is public (that is the whole point); the download asks for a login,
// which is what turns a search visit into someone we know.

type Item = {
  id: string; title: string; kind: string; share_slug: string;
  share_summary: string | null; created_at: string;
  subject_id: string | null; solution_url: string | null;
};

const KIND_LABEL: Record<string, string> = {
  past_papers: "Past exam paper",
  rtp: "ICAI Revision Test Paper",
  mtp: "ICAI Mock Test Paper",
  question_bank: "Question bank",
  notes: "Notes",
  icai: "ICAI study material",
};

async function getItem(slug: string): Promise<Item | null> {
  if (!/^[a-z0-9-]{3,90}$/.test(slug)) return null;
  const svc = tryServiceClient();
  if (!svc) return null;
  const { data } = await svc
    .from("repository_items")
    .select("id, title, kind, share_slug, share_summary, created_at, subject_id, solution_url")
    .eq("share_slug", slug)
    .eq("public_sample", true)
    .eq("is_active", true)
    .maybeSingle();
  return (data as Item) ?? null;
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const it = await getItem(slug);
  if (!it) return { title: "Free download — CA Parveen Sharma" };
  const label = KIND_LABEL[it.kind] ?? "Study material";
  const title = `${it.title} — free PDF download`;
  const description =
    it.share_summary ||
    `Download ${it.title} free. ${label} for CA students, shared by CA Parveen Sharma (36 years of teaching).`;
  return {
    title,
    description,
    alternates: { canonical: `/notes/${it.share_slug}` },
    openGraph: { type: "article", title, description },
  };
}

export default async function NotePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const it = await getItem(slug);
  if (!it) notFound();

  const label = KIND_LABEL[it.kind] ?? "Study material";
  // Google reads this and can show the download as a rich result.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: it.title,
    description: it.share_summary || `${label} for CA students — free download.`,
    learningResourceType: label,
    educationalLevel: "Chartered Accountancy",
    isAccessibleForFree: true,
    url: `https://caparveensharma.com/notes/${it.share_slug}`,
    provider: { "@type": "EducationalOrganization", name: "CA Parveen Sharma", url: "https://caparveensharma.com" },
  };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 780 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <p className="crumb"><Link href="/notes">← All free downloads</Link></p>

      <div className="learn-hero">
        <span className="badge">📄 {label} · free</span>
        <h1>{it.title}</h1>
        {it.share_summary && <p className="meta">{it.share_summary}</p>}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <p style={{ marginTop: 0 }}>
          This PDF is free. Sign in with your email — it takes a moment, and it means we can tell you when the
          material is updated for a new attempt.
        </p>
        <Link className="btn" href={`/notes/${it.share_slug}/download`}>⬇️ Download the PDF</Link>
        {it.solution_url && (
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 10, marginBottom: 0 }}>
            A solution file is included with this paper.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <strong>Who this is for</strong>
        <p className="muted" style={{ fontSize: ".9rem", margin: "6px 0 0" }}>
          CA Foundation, Intermediate and Final students preparing with CA Parveen Sharma, who has taught Financial
          Reporting and Advanced Accounting for 36 years. The same site has a free day-by-day study planner and free
          chapter tests with a concept-wise report.
        </p>
        <p style={{ marginTop: 12, marginBottom: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn small secondary" href="/free-planner">Free study planner</Link>
          <Link className="btn small secondary" href="/courses">Courses</Link>
          <Link className="btn small secondary" href="/articles">Free articles</Link>
        </p>
      </div>
    </section>
  );
}
