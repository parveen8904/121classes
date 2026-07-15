import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { tryServiceClient } from "@/lib/supabase/service";
import { mdToHtml } from "@/lib/markdown";

export const revalidate = 3600;

async function getArticle(slug: string) {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  const svc = tryServiceClient();
  if (!svc) return null;
  const { data } = await svc
    .from("articles")
    .select("slug, title, description, body_md, category, created_at, updated_at")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const a = await getArticle(params.slug);
  if (!a) return { title: "Article — CA Parveen Sharma" };
  return {
    title: `${a.title} — CA Parveen Sharma`,
    description: (a.description as string) || undefined,
    alternates: { canonical: `/articles/${a.slug}` },
    openGraph: { type: "article", title: a.title as string, description: (a.description as string) || undefined },
  };
}

// Pull Q&As out of the article's "## FAQs" section for FAQPage rich results.
// Questions are ### headings (or bold lines); the answer is the text until the
// next question. Best-effort — no FAQs found simply means no FAQ schema.
function extractFaqs(md: string): { q: string; a: string }[] {
  const m = md.match(/^##\s*FAQs?\b[^\n]*\n([\s\S]*)$/im);
  if (!m) return [];
  const section = m[1].split(/^##\s/m)[0];
  const out: { q: string; a: string }[] = [];
  let q = "", buf: string[] = [];
  const push = () => { if (q && buf.join(" ").trim()) out.push({ q, a: buf.join(" ").replace(/\s+/g, " ").trim().slice(0, 500) }); };
  for (const line of section.split(/\r?\n/)) {
    const qm = line.match(/^###\s+(.+)$/) || line.match(/^\*\*(.+?)\*\*\s*$/);
    if (qm) { push(); q = qm[1].replace(/[*#]/g, "").trim(); buf = []; }
    else if (q) buf.push(line.trim());
  }
  push();
  return out.slice(0, 5);
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const a = await getArticle(params.slug);
  if (!a) notFound();

  const faqs = extractFaqs(a.body_md as string);
  const extraLd: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://caparveensharma.com" },
        { "@type": "ListItem", position: 2, name: "Study Articles", item: "https://caparveensharma.com/articles" },
        { "@type": "ListItem", position: 3, name: a.title },
      ],
    },
    ...(faqs.length >= 2 ? [{
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    }] : []),
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description || undefined,
    datePublished: a.created_at,
    dateModified: a.updated_at,
    author: { "@type": "Person", name: "CA Parveen Sharma", url: "https://caparveensharma.com" },
    publisher: { "@type": "Organization", name: "CA Parveen Sharma", logo: { "@type": "ImageObject", url: "https://caparveensharma.com/icon-512.png" } },
    mainEntityOfPage: `https://caparveensharma.com/articles/${a.slug}`,
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {extraLd.map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb"><Link href="/articles">← All articles</Link></p>
        <h1 style={{ lineHeight: 1.2 }}>{a.title}</h1>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>
          By CA Parveen Sharma · {new Date(a.created_at as string).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
        </p>
        <article
          className="article-body"
          style={{ marginTop: 18, lineHeight: 1.7, fontSize: ".97rem" }}
          dangerouslySetInnerHTML={{ __html: mdToHtml(a.body_md as string) }}
        />
        <p className="muted" style={{ fontSize: ".76rem", marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          Educational article — always cross-check specific limits, dates and rules with the latest ICAI study material and announcements.
        </p>
        <div className="card" style={{ marginTop: 18, textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>📅 Make this part of your plan</h3>
          <p className="muted" style={{ fontSize: ".9rem" }}>Free day-by-day study plan + chapter tests + case-scenario practice.</p>
          <Link className="btn" href="/free-planner?src=article">Build my free plan →</Link>
        </div>
      </section>
    </main>
  );
}
