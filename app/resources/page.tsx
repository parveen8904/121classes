import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Free Resources — 121 CA Classes",
  description: "Free CA study resources — RTPs, notes, amendments and important PDFs shared by CA Parveen Sharma.",
};

const KIND_ICON: Record<string, string> = {
  icai: "🏛️", book: "📕", notes: "📝", important_qs: "📌", revision_qs: "🔁", transcript: "🎙️", other: "📄",
};

export default async function ResourcesPage() {
  const svc = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: items } = await svc
    .from("repository_items")
    .select("id, title, resource_label, kind, file_url, subject_id, valid_from, valid_to, subjects(title)")
    .eq("share_to_resources", true)
    .eq("is_active", true)
    .not("file_url", "is", null)
    .order("created_at", { ascending: false });

  const live = (items ?? []).filter((r) => {
    if (r.valid_from && r.valid_from > today) return false;
    if (r.valid_to && r.valid_to < today) return false;
    return true;
  });

  // Group by subject for a tidy layout.
  const groups = new Map<string, typeof live>();
  for (const r of live) {
    const subj = (r as { subjects?: { title?: string } | null }).subjects?.title ?? "General";
    if (!groups.has(subj)) groups.set(subj, []);
    groups.get(subj)!.push(r);
  }

  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 920 }}>
        <span className="badge">🎁 Free resources</span>
        <h1 style={{ margin: "14px 0 6px" }}>Free CA study resources</h1>
        <p className="muted" style={{ maxWidth: 640 }}>
          Handpicked PDFs shared by CA Parveen Sharma — RTPs, important questions, amendments and notes. Free to download.
        </p>

        {live.length === 0 ? (
          <div className="card" style={{ marginTop: 24 }}>
            <p className="muted">📭 Resources will be shared here soon. Check back shortly!</p>
          </div>
        ) : (
          <div style={{ marginTop: 24, display: "grid", gap: 24 }}>
            {[...groups.entries()].map(([subject, list]) => (
              <div key={subject}>
                <h2 style={{ fontSize: "1.1rem", marginBottom: 10 }}>{subject}</h2>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
                  {list.map((r) => (
                    <a
                      key={r.id}
                      href={r.file_url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="card"
                      style={{ display: "flex", gap: 10, alignItems: "center", textDecoration: "none" }}
                    >
                      <span style={{ fontSize: "1.4rem" }}>{KIND_ICON[r.kind] ?? "📄"}</span>
                      <span style={{ flex: 1 }}>
                        <strong style={{ display: "block" }}>{r.resource_label || r.title}</strong>
                        <span className="muted" style={{ fontSize: ".8rem" }}>Download PDF →</span>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
